"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCurrentUser,
  assertClaim,
  assertCanOn,
} from "@/lib/auth/claims";
import { dispatch } from "@/lib/pipeline/dispatch";
import { contentHash } from "@/lib/pipeline/process-document";
import { MIN_CHUNK } from "@/lib/pipeline/chunk";
import {
  validateProjectInput,
  validateProjectMeta,
  type FieldErrors,
} from "@/lib/projects/validate";
import { parseLinks, MAX_LINKS_PER_PROJECT } from "@/lib/projects/links";
import { writeAudit } from "@/lib/audit/write";
import { MAX_FILES_PER_PROJECT } from "@/lib/uploads/mime";

export type ActionState = {
  error?: string;
  fieldErrors?: FieldErrors;
};

/**
 * What the client sends after uploading straight to Storage. The ids were
 * minted by /api/upload-url, so the storage key and the row agree.
 */
export type UploadedFile = {
  documentId: string;
  storageKey: string;
  filename: string;
  mime: string;
  size: number;
  docRole: string;
};

function parseUploaded(raw: FormDataEntryValue | null): UploadedFile[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as UploadedFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Reads the Part C/D metadata fields off a form post.
 *
 * "" means "not supplied" for every one of them: a cleared <input> and an
 * absent key are indistinguishable in a form post, and both mean NULL.
 */
function parseMeta(formData: FormData) {
  return {
    engagementType: String(formData.get("engagement_type") ?? "").trim(),
    startDate: String(formData.get("start_date") ?? "").trim(),
    endDate: String(formData.get("end_date") ?? "").trim(),
    teamSize: String(formData.get("team_size") ?? "").trim(),
    // NOT read from the form. nda_status is writable only through
    // set_nda_status() (migration 0013), because `projects` has a column-level
    // grant that excludes it — a PATCH carrying nda_status gets 42501.
    ndaStatus: "",
  };
}

/**
 * The columns, from validated meta. `|| null` and never `|| undefined`:
 * PostgREST OMITS undefined keys, which on an INSERT means the column default
 * applies and on an UPDATE means "leave unchanged" — so a cleared field would
 * silently keep its old value instead of being cleared.
 */
function metaColumns(meta: ReturnType<typeof parseMeta>) {
  return {
    engagement_type: meta.engagementType || null,
    start_date: meta.startDate || null,
    end_date: meta.endDate || null,
    team_size: meta.teamSize ? Number(meta.teamSize) : null,
  };
}

/**
 * ORDERING IS LOAD-BEARING: insert → after() → revalidatePath() → redirect().
 *
 * PRD §10 specifies "insert → redirect immediately → after(dispatch)". That
 * cannot work: redirect() throws NEXT_REDIRECT, so the dispatch registration is
 * unreachable and NO PROJECT WOULD EVER PROCESS. after() does survive a
 * redirect — but only if it was registered before the throw.
 *
 * redirect() must also sit OUTSIDE any try/catch, or the control-flow exception
 * gets swallowed as an error.
 */
export async function createProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  // Re-proven here, not inherited from the proxy: a matcher change or a
  // refactor can silently remove proxy coverage from a Server Action.
  try {
    assertClaim(user, "projects:create");
  } catch {
    return { error: "You do not have permission to create projects." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const uploaded = parseUploaded(formData.get("files"));

  if (uploaded.length > MAX_FILES_PER_PROJECT) {
    return { error: `A project can hold at most ${MAX_FILES_PER_PROJECT} files.` };
  }

  // Threaded from the real count, not hard-coded 0: descriptionMinFor() drops
  // the 200-char minimum to 0 once files are attached, and passing 0 here made
  // the server reject exactly the submissions the client had just permitted.
  const meta = parseMeta(formData);
  const links = parseLinks(String(formData.get("links") ?? ""));
  if (links.length > MAX_LINKS_PER_PROJECT) {
    return { error: `A project can hold at most ${MAX_LINKS_PER_PROJECT} links.` };
  }

  const fieldErrors = {
    ...validateProjectInput({ title, description }, uploaded.length),
    ...validateProjectMeta(meta),
  };
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  let projectId: string;
  const documentIds: string[] = [];

  try {
    // The USER's client, not the admin client: RLS re-proves projects:create
    // and documents_insert. The admin client appears only in lib/pipeline.
    const supabase = await createClient();

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        // The client minted this when it asked for the first upload URL, so the
        // objects already sitting in Storage are under this project's prefix.
        ...(uploaded[0] ? { id: uploaded[0].storageKey.split("/")[1] } : {}),
        title,
        description,
        status: "processing",
        created_by: user.id,
        last_updated_by: user.id,
        ...metaColumns(meta),
      })
      .select("id")
      .single();

    if (projectError || !project) {
      return { error: projectError?.message ?? "Could not create the project." };
    }
    projectId = project.id;

    // ── The synthetic document ────────────────────────────────────────────
    // A description-only project still flows through the ordinary pipeline by
    // being represented as one document row. Because raw_text is populated at
    // insert time, processDocument needs no extraction branch for T4 at all.
    //
    // Every NOT NULL / CHECK on `documents` is satisfied deliberately:
    //   filename    'description' — also what makes best_source read naturally
    //   mime        text/plain    — routes to the trivial T6 extraction branch
    //   size_bytes  byteLength    — CHECK > 0, guaranteed by the 200-char min
    //   storage_key null          — nullable; this is what makes the trick legal
    //   is_synthetic true         — a partial unique index allows only one
    // CONDITIONAL, and the threshold is MIN_CHUNK rather than 0.
    //
    // Two separate floors have to be cleared. `size_bytes > 0` is a CHECK on
    // the table and one character satisfies it — but the chunker discards
    // anything below MIN_CHUNK as noise, so a 1..29-character description
    // inserts a document that can NEVER produce a chunk and can never reach
    // 'done'. Both floors used to be guaranteed by the 200-char description
    // minimum; attaching files removes that guarantee.
    //
    // validate.ts rejects that range at the form; this is the server backstop.
    if (description.length >= MIN_CHUNK) {
      const { data: document, error: documentError } = await supabase
        .from("documents")
        .insert({
          project_id: projectId,
          filename: "description",
          mime: "text/plain",
          size_bytes: Buffer.byteLength(description, "utf8"),
          storage_key: null,
          content_hash: contentHash(description),
          doc_role: "project description",
          status: "queued",
          raw_text: description,
          is_synthetic: true,
        })
        .select("id")
        .single();

      if (documentError || !document) {
        return { error: documentError?.message ?? "Could not queue processing." };
      }
      documentIds.push(document.id);
    }

    if (uploaded.length > 0) {
      const { data: rows, error: filesError } = await supabase
        .from("documents")
        .insert(
          uploaded.map((file) => ({
            id: file.documentId,
            project_id: projectId,
            filename: file.filename,
            mime: file.mime,
            size_bytes: file.size,
            storage_key: file.storageKey,
            doc_role: file.docRole.trim() || null,
            status: "queued" as const,
          })),
        )
        .select("id");

      if (filesError) return { error: filesError.message };
      for (const row of rows ?? []) documentIds.push(row.id);
    }

    if (documentIds.length === 0) {
      return { error: "Add a description or attach at least one document." };
    }

    // Links are metadata, not corpus: they are never chunked or embedded, so
    // this insert sits outside the documentIds bookkeeping entirely and does
    // not affect whether the project has anything to process.
    if (links.length > 0) {
      const { error: linksError } = await supabase.from("project_links").insert(
        links.map((l) => ({
          project_id: projectId,
          url: l.url,
          title: l.title,
        })),
      );
      if (linksError) return { error: linksError.message };
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not create the project.",
    };
  }

  // Before the after()/revalidate/redirect chain, which is ordered and must
  // stay contiguous — redirect() throws NEXT_REDIRECT, so anything after it is
  // unreachable.
  await writeAudit({
    actorId: user.id,
    action: "project.create",
    entityType: "project",
    entityId: projectId,
    meta: { title, documents: documentIds.length },
  });

  after(() => dispatch(documentIds, projectId)); // 1. register BEFORE redirect
  revalidatePath("/projects"); // 2.
  redirect(`/projects/${projectId}`); // 3. LAST, outside try/catch
}

/**
 * Editing the description UPDATES the existing synthetic document rather than
 * inserting a second one — both partial unique indexes forbid that.
 *
 * Resetting projects.status to 'processing' is what lets claim_finalize win
 * again; without it the project would never leave 'ready' and the new summary
 * would never be generated.
 */
export async function updateProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const meta = parseMeta(formData);
  if (!projectId) return { error: "Missing project id." };

  /*
   * The check runs AFTER projectId is parsed, deliberately — it needs the id.
   * A bare assertClaim("projects:update") here would reject every scoped
   * editor outright, so this REPLACES that check rather than supplementing it.
   *
   * RLS remains the boundary: projects_update_scoped / documents_*_scoped are
   * what actually decide this. Without the check the write would simply match
   * zero rows and PostgREST would report success having done nothing — a
   * silent no-op, which is worse for the user than an error.
   */
  try {
    await assertCanOn(user, "projects:update", projectId);
  } catch {
    return { error: "You do not have permission to edit this project." };
  }

  const supabase = await createClient();

  // A files-only project has no description, so the 200-char rule must not
  // apply to it. Count the real documents rather than assuming zero.
  const { count: fileCount } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("is_active", true)
    .eq("is_synthetic", false);

  const fieldErrors = {
    ...validateProjectInput({ title, description }, fileCount ?? 0),
    ...validateProjectMeta(meta),
  };
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const { data: synthetic } = await supabase
    .from("documents")
    .select("id, content_hash")
    .eq("project_id", projectId)
    .eq("is_synthetic", true)
    .maybeSingle();

  const nextHash = contentHash(description);
  const descriptionChanged = synthetic?.content_hash !== nextHash;

  const { error: updateError } = await supabase
    .from("projects")
    .update({
      title,
      description,
      last_updated_by: user.id,
      // UNCONDITIONAL, deliberately outside the descriptionChanged spread:
      // none of these columns is read by the pipeline, so changing team_size
      // must not re-run the summariser. The existing gate below is what keeps
      // a metadata edit from costing an OpenAI call.
      ...metaColumns(meta),
      ...(descriptionChanged ? { status: "processing" as const } : {}),
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  await writeAudit({
    actorId: user.id,
    action: "project.update",
    entityType: "project",
    entityId: projectId,
    meta: { title, description_changed: descriptionChanged },
  });

  // Unchanged text means nothing to re-embed and nothing to re-summarise.
  if (!descriptionChanged || !synthetic) {
    revalidatePath(`/projects/${projectId}`);
    return {};
  }

  const { error: docError } = await supabase
    .from("documents")
    .update({
      raw_text: description,
      size_bytes: Buffer.byteLength(description, "utf8"),
      content_hash: nextHash,
      status: "queued",
      attempts: 0,
      error: null,
    })
    .eq("id", synthetic.id);

  if (docError) return { error: docError.message };

  after(() => dispatch([synthetic.id], projectId));
  revalidatePath(`/projects/${projectId}`);
  return {};
}

/** Soft delete: deleted_at is what every RLS policy and query filters on. */
export async function deleteProject(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  assertClaim(user, "projects:delete");

  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  const supabase = await createClient();

  /*
   * Via an RPC, not a direct UPDATE.
   *
   * projects_select filters `deleted_at is null`, and PostgreSQL checks the NEW
   * row of an UPDATE against the SELECT policy — so writing deleted_at makes
   * the row invisible to its own writer and Postgres raises "new row violates
   * row-level security policy". A direct update can never soft-delete,
   * whatever claims the user holds. See supabase/migrations/0006_soft_delete.sql.
   *
   * soft_delete_project performs the same has_claim('projects:delete') check the
   * policy would have, so authorization is unchanged — only the mechanism is.
   */
  const { error } = await supabase.rpc("soft_delete_project", {
    p_project: projectId,
  });
  if (error) throw new Error(error.message);

  // Soft delete, so the row survives — but the files do not: the sweep purges
  // them once deleted_at passes the retention window (0009). This row is the
  // only record of who started that clock.
  await writeAudit({
    actorId: user.id,
    action: "project.delete",
    entityType: "project",
    entityId: projectId,
  });

  revalidatePath("/projects");
  redirect("/projects");
}

/**
 * Attaches already-uploaded files to an EXISTING project.
 *
 * ORDERING IS LOAD-BEARING, and getting it wrong fails silently:
 *
 *   claim_finalize is `update projects set status='finalizing' where id = ...
 *   and status = 'processing'`. Insert documents into a project sitting at
 *   'ready' and dispatch without resetting the status, and every document
 *   processes to 'done' while claim_finalize returns false forever — no
 *   re-summary, and the cron sweep's stranded-in-'finalizing' rescue never
 *   helps because the project was never in 'finalizing'.
 *
 * So: insert as 'queued' FIRST (safe — claim_finalize counts queued rows as
 * pending, so nothing can finalize underneath us), then flip the project to
 * 'processing', and only then dispatch.
 */
export async function addFilesToProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project id." };

  /*
   * The check runs AFTER projectId is parsed, deliberately — it needs the id.
   * A bare assertClaim("projects:update") here would reject every scoped
   * editor outright, so this REPLACES that check rather than supplementing it.
   *
   * RLS remains the boundary: projects_update_scoped / documents_*_scoped are
   * what actually decide this. Without the check the write would simply match
   * zero rows and PostgREST would report success having done nothing — a
   * silent no-op, which is worse for the user than an error.
   */
  try {
    await assertCanOn(user, "projects:update", projectId);
  } catch {
    return { error: "You do not have permission to add documents here." };
  }

  const uploaded = parseUploaded(formData.get("files"));
  if (uploaded.length === 0) return { error: "Attach at least one document." };

  const supabase = await createClient();

  // The authority on the per-project cap. /api/upload-url pre-checks it as a
  // courtesy so nobody uploads 50 MB only to be refused here.
  const { count: existing } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("is_active", true)
    .eq("is_synthetic", false);

  if ((existing ?? 0) + uploaded.length > MAX_FILES_PER_PROJECT) {
    return {
      error:
        `A project can hold at most ${MAX_FILES_PER_PROJECT} files — ` +
        `this one already has ${existing ?? 0}.`,
    };
  }

  // 1. Insert as 'queued'.
  const { data: rows, error: insertError } = await supabase
    .from("documents")
    .insert(
      uploaded.map((file) => ({
        id: file.documentId,
        project_id: projectId,
        filename: file.filename,
        mime: file.mime,
        size_bytes: file.size,
        storage_key: file.storageKey,
        doc_role: file.docRole.trim() || null,
        status: "queued" as const,
      })),
    )
    .select("id");

  if (insertError) return { error: insertError.message };
  const documentIds = (rows ?? []).map((r) => r.id);
  if (documentIds.length === 0) return { error: "Could not queue the documents." };

  // 2. Re-arm finalization. Must happen BEFORE any worker can finish.
  const { error: statusError } = await supabase
    .from("projects")
    .update({ status: "processing", last_updated_by: user.id })
    .eq("id", projectId);
  if (statusError) return { error: statusError.message };

  await writeAudit({
    actorId: user.id,
    action: "project.add_files",
    entityType: "project",
    entityId: projectId,
    meta: { documents: documentIds.length },
  });

  // 3. Only now dispatch.
  after(() => dispatch(documentIds, projectId));
  revalidatePath(`/projects/${projectId}`);
  return {};
}

/**
 * Sets a project's NDA/disclosure status.
 *
 * Goes through the `set_nda_status` RPC, not a direct update, and that is not
 * a stylistic choice: migration 0013 revoked the table-level UPDATE grant on
 * `projects` and re-granted every column EXCEPT nda_status, so a PATCH
 * carrying it receives 42501. The definer function re-checks the claim in SQL
 * and re-proves the project is visible.
 *
 * The assertClaim below is therefore the UX layer — it produces a readable
 * message instead of a raw Postgres error — while the RPC is the boundary.
 */
export async function setNdaStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  try {
    assertClaim(user, "projects:set-nda");
  } catch {
    return { error: "You do not have permission to set disclosure status." };
  }

  const projectId = String(formData.get("projectId") ?? "");
  const ndaStatus = String(formData.get("nda_status") ?? "").trim();
  if (!projectId) return { error: "Missing project id." };

  const fieldErrors = validateProjectMeta({
    engagementType: "",
    startDate: "",
    endDate: "",
    teamSize: "",
    ndaStatus,
  });
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_nda_status", {
    p_project: projectId,
    // "" clears it back to "nobody has decided", which disclosure() treats
    // exactly like Permanently Excluded.
    p_status: ndaStatus || null,
  } as { p_project: string; p_status: string });

  if (error) return { error: error.message };

  await writeAudit({
    actorId: user.id,
    action: "project.set_nda_status",
    entityType: "project",
    entityId: projectId,
    // The VALUE is recorded deliberately: this is a legal determination and
    // "who changed it to what, when" is the entire point of auditing it.
    meta: { nda_status: ndaStatus || null },
  });

  revalidatePath(`/projects/${projectId}`);
  return {};
}

/**
 * Flips one document between 'indexed' and 'no_index'.
 *
 * The two directions are NOT symmetrical:
 *
 *   → no_index : delete the chunk set. The document keeps raw_text (§15.2) so
 *                the change is reversible, but its chunks must go or search
 *                would keep citing a source the project no longer indexes.
 *                No re-summary is needed — finalizeProject already excludes
 *                no_index documents from its corpus.
 *
 *   → indexed  : re-queue and re-dispatch. processDocument reads raw_text and
 *                re-chunks with no extraction and no Storage read, which is
 *                exactly why §15.2 exists.
 *
 * The ORDER in the second branch is the same load-bearing sequence
 * addFilesToProject documents: queue the document, THEN flip the project to
 * `processing`, THEN dispatch. Reversed, claim_finalize can win before the
 * document is queued and the project reaches `ready` with the re-chunk still
 * pending; and if the project is left `ready`, claim_finalize returns false
 * forever and no re-summary ever happens.
 */
export async function setDocumentVisibility(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const projectId = String(formData.get("projectId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const visibility = String(formData.get("visibility") ?? "");
  if (!projectId || !documentId) return { error: "Missing document id." };
  if (visibility !== "indexed" && visibility !== "no_index") {
    return { error: "Unknown visibility." };
  }

  // Scoped, as in updateProject. Note the chunk delete below uses the ADMIN
  // client, which bypasses RLS entirely — so for that write this check is not
  // merely a nicer error, it is the only authorization there is.
  try {
    await assertCanOn(user, "projects:update", projectId);
  } catch {
    return { error: "You do not have permission to edit this project." };
  }

  const supabase = await createClient();

  // The user's client: documents_update is the authorization check.
  const { error: visError } = await supabase
    .from("documents")
    .update({ visibility })
    .eq("id", documentId)
    .eq("project_id", projectId);

  if (visError) return { error: visError.message };

  if (visibility === "no_index") {
    // Chunks are service-role-only (0002: "written exclusively by the
    // pipeline via the service role"), so this cannot go through the user's
    // client — there is no chunks policy that would permit it.
    const admin = createAdminClient();
    const { error: delError } = await admin
      .from("chunks")
      .delete()
      .eq("document_id", documentId);
    if (delError) return { error: delError.message };

    await writeAudit({
      actorId: user.id,
      action: "document.no_index",
      entityType: "document",
      entityId: documentId,
      meta: { project_id: projectId },
    });

    revalidatePath(`/projects/${projectId}`);
    return {};
  }

  // → indexed. Re-queue first.
  const { error: queueError } = await supabase
    .from("documents")
    .update({ status: "queued", attempts: 0, error: null })
    .eq("id", documentId);
  if (queueError) return { error: queueError.message };

  // THEN the project, or claim_finalize never fires (it only acts on
  // `processing`) and no re-summary happens.
  const { error: projError } = await supabase
    .from("projects")
    .update({ status: "processing", last_updated_by: user.id })
    .eq("id", projectId);
  if (projError) return { error: projError.message };

  await writeAudit({
    actorId: user.id,
    action: "document.reindex",
    entityType: "document",
    entityId: documentId,
    meta: { project_id: projectId },
  });

  after(() => dispatch([documentId], projectId));
  revalidatePath(`/projects/${projectId}`);
  return {};
}
