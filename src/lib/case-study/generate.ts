import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCaseStudyOutline, CHAT_MODEL } from "@/lib/ai/openai";
import { BUCKET } from "@/lib/pipeline/extract";
import { disclosure } from "@/lib/projects/disclosure";
import { asCaseStudyOutline, type StoredCaseStudyOutline } from "@/lib/types";
import { CASE_STUDY_SECTIONS, SECTION_BY_KEY } from "./sections";
import { DOCX_MIME, caseStudyFilename, renderCaseStudyDocx } from "./docx";

/**
 * Generates the case study outline, materialises it as a DOCX in Storage, and
 * permanently removes the object it replaces (migration 0018).
 *
 * Called from finalizeProject, inside its own try/catch — see the call site
 * for why that isolation is mandatory rather than defensive.
 *
 * ── THE KEY PREFIX IS `case-studies/`, NOT `projects/` ────────────────────
 * Load-bearing. The 0009 sweep's removeAbandonedUploads() walks
 * `projects/{projectId}` and deletes any child prefix that is not a live
 * `documents.id`, once it is over 30 minutes old. This object has no
 * `documents` row BY DESIGN — giving it one would feed the generated text
 * back into the corpus it came from — so under `projects/` it would be
 * deleted half an hour after generation, silently, by a 5-minute cron.
 */

/** Every generated object lives under this prefix. See above. */
const KEY_PREFIX = "case-studies";

export type CaseStudyResult =
  | { ok: true; storageKey: string | null }
  | { ok: false; reason: string };

/**
 * ── WRITE ORDER: RENDER → UPLOAD NEW → UPDATE ROW → DELETE OLD ────────────
 *
 * Deliberate, and the alternative orderings each break something:
 *
 *   delete-old first  — an upload failure then leaves the row pointing at
 *                       bytes that no longer exist: a broken download link,
 *                       AND the previous outline destroyed for nothing. This
 *                       is the same trap finalizeProject documents for the
 *                       features wipe (after the model call, never before).
 *
 *   update row first  — a row pointing at an object that was never uploaded.
 *
 * Upload-first means the worst case is ONE orphaned object, which sweep step
 * 6 reclaims. The old key is captured from the row BEFORE it is overwritten,
 * because after the update there is no record of it anywhere.
 *
 * A NEW UUID PER GENERATION, never a stable key overwritten in place. An
 * overwrite would make "the previous one is permanently deleted" true only by
 * accident of the storage backend, and a CDN or client cache could serve the
 * superseded document from the unchanged URL. A fresh key makes replacement
 * observable and cache-safe.
 */
export async function generateCaseStudy(input: {
  projectId: string;
  title: string;
  corpus: string;
  ndaStatus: string | null;
}): Promise<CaseStudyResult> {
  const admin = createAdminClient();

  // Captured BEFORE the row is overwritten — this is the only record of the
  // object we are replacing.
  const { data: previous } = await admin
    .from("project_case_study")
    .select("storage_key")
    .eq("project_id", input.projectId)
    .maybeSingle();

  const previousKey = previous?.storage_key ?? null;

  const d = disclosure(input.ndaStatus);

  // 1. Generate. The expensive step, and the one that can legitimately fail.
  const generated = await generateCaseStudyOutline({
    title: input.title,
    corpus: input.corpus,
    sections: CASE_STUDY_SECTIONS,
    // Fails closed via disclosure(); generateCaseStudyOutline ALSO defaults
    // this to false, so both layers err the same way.
    mayUseClientName: d.mayUseClientName,
  });

  const outline = toStoredOutline(generated);
  if (!outline) return { ok: false, reason: "The model returned no usable sections." };

  const filename = caseStudyFilename(input.title);

  // 2. Render.
  const buffer = await renderCaseStudyDocx({
    title: input.title,
    outline,
    briefs: new Map(CASE_STUDY_SECTIONS.map((s) => [s.key, s.brief])),
    generatedAt: new Date(),
    // Only the restrictive case gets a notice. A document that announces
    // "cleared for external use" would be read as a legal clearance, which
    // this system is not in a position to issue.
    disclosureNotice: d.mayUseClientName
      ? null
      : "Client must not be named in external use. Check the disclosure " +
        "status on the project before publishing.",
  });

  // 3. Upload the NEW object, under a fresh key.
  const storageKey = `${KEY_PREFIX}/${input.projectId}/${randomUUID()}/${filename}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storageKey, buffer, {
      contentType: DOCX_MIME,
      // Nothing can pre-exist at a freshly minted uuid, so an upsert would
      // only mask a key-collision bug.
      upsert: false,
    });

  // The generation SURVIVES an upload failure. The outline is written to the
  // row with a null storage_key, so the page renders it and the (expensive)
  // model call is not thrown away — the next regenerate retries the upload.
  // This is exactly why `outline` is stored alongside the object (0018).
  if (uploadError) {
    await writeRow(admin, input.projectId, outline, null, filename, null);
    console.error(`[case-study:upload] ${input.projectId}:`, uploadError.message);
    return { ok: false, reason: uploadError.message };
  }

  // 4. Point the row at the new object.
  const written = await writeRow(
    admin,
    input.projectId,
    outline,
    storageKey,
    filename,
    buffer.byteLength,
  );

  if (!written) {
    // The row still references the OLD key (or none). Remove the object we
    // just uploaded rather than leaving an unreferenced one behind, and do
    // NOT touch the old object — it is still the live one.
    await removeObjects(admin, [storageKey], input.projectId);
    return { ok: false, reason: "Could not record the generated outline." };
  }

  // 5. Delete the superseded object. LAST, and never fatal: the row already
  //    points at the new file, so the feature has succeeded. Sweep step 6
  //    reclaims anything missed here.
  if (previousKey && previousKey !== storageKey) {
    await removeObjects(admin, [previousKey], input.projectId);
  }

  return { ok: true, storageKey };
}

/**
 * Removes a project's outline entirely — row and object.
 *
 * Called from finalizeProject's "no usable documents" branch: a project whose
 * last document was removed must not keep offering a downloadable case study
 * built from a corpus that no longer exists.
 *
 * OBJECT FIRST, THEN ROW, and the order is the same one purgeDeletedProjects
 * uses for the same reason: the row is the only record of the key. Delete it
 * first and a failed Storage removal strands the bytes with nothing left to
 * find them by. This way a failure leaves a row pointing at a missing object,
 * which the page already handles (a signed URL for a deleted object 404s) and
 * which the next generation overwrites.
 *
 * Never throws — every caller runs after work that has already committed.
 */
export async function discardCaseStudy(projectId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("project_case_study")
    .select("storage_key")
    .eq("project_id", projectId)
    .maybeSingle();

  if (!existing) return;

  if (existing.storage_key) {
    await removeObjects(admin, [existing.storage_key], projectId);
  }

  const { error } = await admin
    .from("project_case_study")
    .delete()
    .eq("project_id", projectId);

  if (error) {
    console.error(`[case-study:discard] ${projectId}:`, error.message);
  }
}

async function writeRow(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  outline: StoredCaseStudyOutline,
  storageKey: string | null,
  filename: string,
  sizeBytes: number | null,
): Promise<boolean> {
  // upsert on the PK: one row per project, replaced wholesale. `generated_at`
  // is set explicitly because the column default only applies on INSERT, and
  // this is an UPDATE for every project after the first generation.
  const { error } = await admin.from("project_case_study").upsert(
    {
      project_id: projectId,
      outline,
      storage_key: storageKey,
      filename,
      size_bytes: sizeBytes,
      model: CHAT_MODEL,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" },
  );

  if (error) {
    console.error(`[case-study:row] ${projectId}:`, error.message);
    return false;
  }
  return true;
}

/** Storage removal that logs and never throws. */
async function removeObjects(
  admin: ReturnType<typeof createAdminClient>,
  keys: string[],
  projectId: string,
): Promise<void> {
  const { error } = await admin.storage.from(BUCKET).remove(keys);
  if (error) {
    // Not fatal anywhere it is called from. Sweep step 6 is the backstop that
    // makes "permanently deleted" convergent rather than best-effort.
    console.error(`[case-study:remove] ${projectId}:`, error.message);
  }
}

/**
 * Normalises the model's output against OUR section list.
 *
 * ── THE SKELETON IS OURS, SO IT IS REBUILT HERE, NOT TRUSTED ──────────────
 * Iterates CASE_STUDY_SECTIONS and looks up what the model returned for each
 * key — rather than iterating the model's array. Three properties follow, and
 * all three are the reason for doing it this way round:
 *
 *   • ORDER is always the house order, whatever order the model replied in.
 *   • A section the model OMITTED still appears, with empty content. A
 *     missing heading would silently shrink the document; an empty one tells
 *     the writer the material did not support it.
 *   • A key the model INVENTED is dropped. Rendering it would let the
 *     document's structure drift between regenerations of the same project.
 *
 * `label` is snapshotted from the list at generation time — see
 * CaseStudyOutlineSection: a later rename must not relabel old documents.
 */
function toStoredOutline(generated: {
  headline: string | null;
  sections: { key: string; content: string }[];
}): StoredCaseStudyOutline | null {
  const byKey = new Map(generated.sections.map((s) => [s.key, s]));

  const sections = CASE_STUDY_SECTIONS.map((section) => {
    const returned = byKey.get(section.key);
    return {
      key: section.key,
      label: section.label,
      content: returned?.content?.trim() ?? "",
    };
  });

  // Re-narrowed through the same function the read path uses, so a shape that
  // would not survive a page render never reaches the database.
  const headline = generated.headline?.trim();
  return asCaseStudyOutline({
    headline: headline || null,
    sections,
  });
}

/** Used by the sweep to recognise keys it owns. */
export const CASE_STUDY_KEY_PREFIX = KEY_PREFIX;

/** Re-exported so callers need not reach past this module. */
export { SECTION_BY_KEY };
