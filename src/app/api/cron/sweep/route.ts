import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/pipeline/extract";
import { CASE_STUDY_KEY_PREFIX } from "@/lib/case-study/generate";
import { serverEnv } from "@/lib/env";

export const maxDuration = 800;

/**
 * Recovers work lost to crashed invocations, and reclaims storage nothing else
 * will (PRD §13). Scheduled every 5 minutes in vercel.json — a Pro-plan
 * feature; Hobby is limited to daily crons and would fail the deployment.
 *
 * Six steps, in order of urgency. Every one is bounded per tick and every one
 * swallows its own failures: a sweep that throws halfway leaves the remaining
 * steps un-run until the next tick, and step 1 is the one that must never be
 * starved.
 *
 * Steps 4-6 are all storage reclamation, and they are three steps rather than
 * one because each finds its garbage a different way: step 4 from
 * `documents.storage_key` for soft-deleted projects, step 5 by walking
 * `projects/` for objects with no row at all, and step 6 by walking
 * `case-studies/` for outlines that a regeneration superseded. An outline has
 * no `documents` row by design (0018), so steps 4 and 5 are structurally
 * incapable of seeing one.
 */

/** Objects per storage.remove() call. Keeps the request body sane. */
const REMOVE_BATCH = 100;

/**
 * How long an object may exist with no `documents` row before step 5 considers
 * it abandoned.
 *
 * THIS GUARD IS LOAD-BEARING, NOT A COURTESY. /api/upload-url mints the storage
 * key and hands back a signed URL BEFORE the documents row exists — the row is
 * inserted by the server action only after the browser finishes uploading. So
 * every upload in flight is, by definition, an object with no row. A sweep
 * without this guard deletes files that are uploading correctly, and the user
 * sees an extraction failure they cannot reproduce (it only happens when the
 * 5-minute cron lands mid-upload). 30 minutes comfortably covers a 200 MB
 * upload on a bad connection.
 */
const ABANDONED_AFTER_MS = 30 * 60_000;

/** Undelete grace period before a soft-deleted project's files are purged. */
const RETENTION_DAYS = 30;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(null, { status: 403 });
  }

  const admin = createAdminClient();

  // Hoisted out of every loop's try for the same reason as dispatch.ts: those
  // catches are deliberately swallowing, so a config error read inside one
  // would be logged and discarded and the sweep would silently do nothing
  // forever. Hoisting is what lets the throw escape.
  const baseUrl = serverEnv.internalBaseUrl;
  const internalSecret = serverEnv.internalSecret;

  // ── 1. Re-dispatch stuck documents ──────────────────────────────────────
  // Selects BOTH 'queued' and 'processing' — see 0005_rpc.sql for why
  // 'processing' alone stranded projects forever.
  const { data: stuck } = await admin.rpc("stuck_documents", {
    older_than_minutes: 15,
  });

  for (const doc of stuck ?? []) {
    try {
      await fetch(`${baseUrl}/api/process/${doc.id}`, {
        method: "POST",
        headers: { "x-internal": internalSecret },
      });
    } catch (error) {
      console.error(`[sweep:process] ${doc.id}:`, error);
    }
  }

  // ── 2. Escape 'finalizing' ──────────────────────────────────────────────
  // §15.9: every error path forces 'ready'. This is the backstop for the one
  // path that cannot force it itself — the invocation that died mid-finalize.
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: stranded } = await admin
    .from("projects")
    .update({ status: "ready" })
    .eq("status", "finalizing")
    .lt("updated_at", cutoff)
    .select("id");

  // ── 3. Finalize projects stranded in 'processing' ───────────────────────
  // A project whose documents all reached a terminal status while the
  // invocation holding maybeFinalize died. Step 2 cannot help — it never
  // reached 'finalizing'; step 1 cannot either — no document is outstanding.
  //
  // Goes through /api/finalize, which calls claim_finalize, so §15.6 still has
  // exactly one gate and a project that escaped on its own is a no-op here.
  const { data: unfinalized } = await admin.rpc("stranded_projects", {
    older_than_minutes: 15,
  });

  for (const project of unfinalized ?? []) {
    try {
      await fetch(`${baseUrl}/api/finalize/${project.id}`, {
        method: "POST",
        headers: { "x-internal": internalSecret },
      });
    } catch (error) {
      console.error(`[sweep:finalize] ${project.id}:`, error);
    }
  }

  const purged = await purgeDeletedProjects(admin);
  const abandoned = await removeAbandonedUploads(admin);
  const staleOutlines = await removeSupersededCaseStudies(admin);

  return Response.json({
    ok: true,
    requeued: stuck?.length ?? 0,
    unstranded: stranded?.length ?? 0,
    refinalized: unfinalized?.length ?? 0,
    purged,
    abandoned,
    staleOutlines,
  });
}

/**
 * Step 4 — reclaim storage from soft-deleted projects.
 *
 * Supabase Storage does not cascade from Postgres deletes, and nothing in this
 * codebase hard-deletes a project: `soft_delete_project` sets `deleted_at` and
 * stops. Without this the files of every deleted project are billed forever.
 *
 * See 0009_sweep_recovery.sql for why PRD §13's "no matching documents row"
 * rule does not cover this case at all.
 *
 * Rows are kept — only the bytes go. `storage_key` is nulled so the state stays
 * honest: extract.ts already treats a null key as a PermanentExtractionError,
 * and the null is also what stops the next sweep from re-listing the same
 * project forever. `raw_text` is untouched (§15.2).
 */
async function purgeDeletedProjects(
  admin: ReturnType<typeof createAdminClient>,
): Promise<number> {
  try {
    const { data: rows } = await admin.rpc("purgeable_projects", {
      older_than_days: RETENTION_DAYS,
      match_limit: 200,
    });

    if (!rows?.length) return 0;

    let removed = 0;

    for (let i = 0; i < rows.length; i += REMOVE_BATCH) {
      const batch = rows.slice(i, i + REMOVE_BATCH);
      const keys = batch
        .map((r) => r.storage_key)
        .filter((k): k is string => !!k);

      const { error } = await admin.storage.from(BUCKET).remove(keys);
      if (error) {
        console.error("[sweep:purge] remove failed:", error.message);
        continue;
      }

      // Only after the objects are actually gone. Nulling first would strand
      // the bytes with no record of the key that would let us find them again.
      const { error: clearError } = await admin
        .from("documents")
        .update({ storage_key: null })
        .in(
          "id",
          batch.map((r) => r.document_id),
        );

      if (clearError) {
        console.error("[sweep:purge] clear failed:", clearError.message);
        continue;
      }

      removed += keys.length;
    }

    return removed;
  } catch (error) {
    console.error("[sweep:purge]:", error);
    return 0;
  }
}

/**
 * Step 5 — PRD §13's actual rule: objects with no `documents` row.
 *
 * The narrow case it really covers is a user who closed the tab between the
 * upload completing and the server action inserting the row. Legitimate, and
 * otherwise unreclaimable.
 *
 * Driven from Storage rather than from Postgres, because an object with no row
 * is invisible to every query. Scoped to recently-active projects so the walk
 * is bounded — see recently_active_projects in 0009.
 */
async function removeAbandonedUploads(
  admin: ReturnType<typeof createAdminClient>,
): Promise<number> {
  try {
    const { data: projects } = await admin.rpc("recently_active_projects", {
      within_hours: 24,
      match_limit: 20,
    });

    if (!projects?.length) return 0;

    const threshold = Date.now() - ABANDONED_AFTER_MS;
    let removed = 0;

    for (const project of projects) {
      // Storage keys are projects/{projectId}/{documentId}/{filename}, so one
      // level down from the project prefix is a document id.
      const { data: entries, error } = await admin.storage
        .from(BUCKET)
        .list(`projects/${project.id}`, { limit: 100 });

      if (error || !entries?.length) continue;

      const { data: known } = await admin
        .from("documents")
        .select("id")
        .eq("project_id", project.id);

      const legitimate = new Set((known ?? []).map((d) => d.id));

      for (const entry of entries) {
        if (legitimate.has(entry.name)) continue;

        // The prefix entry itself carries no timestamp (Storage reports
        // folders with a null id), so the age guard has to read the file
        // inside it.
        const prefix = `projects/${project.id}/${entry.name}`;
        const { data: files } = await admin.storage
          .from(BUCKET)
          .list(prefix, { limit: 100 });

        if (!files?.length) continue;

        const tooRecent = files.some(
          (f) => !f.created_at || Date.parse(f.created_at) > threshold,
        );
        if (tooRecent) continue;

        const keys = files.map((f) => `${prefix}/${f.name}`);
        const { error: removeError } = await admin.storage
          .from(BUCKET)
          .remove(keys);

        if (removeError) {
          console.error(`[sweep:abandoned] ${prefix}:`, removeError.message);
          continue;
        }

        removed += keys.length;
      }
    }

    return removed;
  } catch (error) {
    console.error("[sweep:abandoned]:", error);
    return 0;
  }
}

/**
 * Step 6 — remove superseded case study outlines (0018).
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────
 * The requirement is that regenerating an outline deletes the previous file
 * PERMANENTLY. generateCaseStudy does delete it inline, but that delete is
 * deliberately non-fatal — the row already points at the new object, so
 * failing the finalize over a storage cleanup would trade a real product
 * outcome for a billing detail. This step is what turns that best-effort
 * delete into a convergent guarantee, and it covers three cases the inline
 * delete cannot:
 *
 *   • the inline remove() failed (Storage 5xx, throttling);
 *   • the invocation died between upload and the row update, leaving an
 *     object nothing references;
 *   • the project was soft-deleted — purgeDeletedProjects (step 4) walks
 *     `documents.storage_key` and CANNOT see these objects, because an
 *     outline deliberately has no `documents` row.
 *
 * ── DRIVEN FROM STORAGE, DIFFED AGAINST THE ROWS ──────────────────────────
 * An unreferenced object is, by definition, invisible to every Postgres
 * query — the same reason removeAbandonedUploads is driven from Storage.
 *
 * ── NO AGE GUARD IS NEEDED HERE, AND THAT IS A REAL DIFFERENCE ────────────
 * removeAbandonedUploads needs its 30-minute guard because /api/upload-url
 * mints a key BEFORE the documents row exists, so every in-flight browser
 * upload legitimately looks abandoned. Nothing analogous happens here: the
 * server uploads the bytes and writes the row within one function, and the
 * row is written only AFTER the upload returns. So "not the current
 * storage_key" is unambiguous rather than a race — with one exception, which
 * the per-project ordering below handles: the row is read AFTER listing that
 * project's objects, so an outline generated during the walk is already in
 * the row by the time we diff and is never deleted.
 */
async function removeSupersededCaseStudies(
  admin: ReturnType<typeof createAdminClient>,
): Promise<number> {
  try {
    // Storage's list() gives no recursive walk, so enumerate the project
    // prefixes under `case-studies/` and descend. Bounded per tick, like
    // every other step; the next tick continues where this one stopped
    // caring, because the work is idempotent.
    const { data: projectPrefixes, error } = await admin.storage
      .from(BUCKET)
      .list(CASE_STUDY_KEY_PREFIX, { limit: 200 });

    if (error || !projectPrefixes?.length) return 0;

    let removed = 0;

    for (const projectEntry of projectPrefixes) {
      // Storage reports a prefix as an entry with a null id; a real file at
      // this level would be a bug, and skipping it is safer than deleting it.
      if (projectEntry.id !== null) continue;

      const projectPrefix = `${CASE_STUDY_KEY_PREFIX}/${projectEntry.name}`;

      const { data: generations } = await admin.storage
        .from(BUCKET)
        .list(projectPrefix, { limit: 100 });

      if (!generations?.length) continue;

      /*
       * The row is read AFTER the listing, deliberately — see the header. A
       * generation that lands mid-walk is then already reflected here, so it
       * cannot be mistaken for a superseded one.
       *
       * A project with NO row (hard-deleted, or an outline discarded by
       * finalizeProject's empty branch) yields a null key, so every object
       * under its prefix is superseded. That is the intended reading, and it
       * is what reclaims a soft-deleted project's outline.
       */
      const { data: row } = await admin
        .from("project_case_study")
        .select("storage_key")
        .eq("project_id", projectEntry.name)
        .maybeSingle();

      const liveKey = row?.storage_key ?? null;

      for (const generation of generations) {
        if (generation.id !== null) continue;

        const generationPrefix = `${projectPrefix}/${generation.name}`;

        // The live key is `case-studies/{project}/{uuid}/{filename}`, so the
        // generation directory is live iff the live key sits inside it.
        // Compared with a trailing slash so `…/abc` cannot prefix-match
        // `…/abcdef`.
        if (liveKey && liveKey.startsWith(`${generationPrefix}/`)) continue;

        const { data: files } = await admin.storage
          .from(BUCKET)
          .list(generationPrefix, { limit: 100 });

        if (!files?.length) continue;

        const keys = files.map((f) => `${generationPrefix}/${f.name}`);
        const { error: removeError } = await admin.storage
          .from(BUCKET)
          .remove(keys);

        if (removeError) {
          console.error(
            `[sweep:case-study] ${generationPrefix}:`,
            removeError.message,
          );
          continue;
        }

        removed += keys.length;
      }
    }

    return removed;
  } catch (error) {
    console.error("[sweep:case-study]:", error);
    return 0;
  }
}
