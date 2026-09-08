import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedBatch } from "@/lib/ai/openai";
import { chunkText, MIN_CHUNK } from "./chunk";
import {
  extractText,
  isPermanentExtractionError,
  PermanentExtractionError,
} from "./extract";
import { toVectorOrNull } from "@/lib/supabase/vector";

const MAX_ATTEMPTS = 3;

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Processes ONE document: extract → chunk → embed → replace chunks → mark done.
 *
 * Shared core. Both transports (the HTTP fan-out and the inline mode) call
 * exactly this, so they cannot diverge in behaviour — only in timeout and
 * memory isolation.
 *
 * Returns the project id so the caller can attempt finalization.
 */
export async function processDocument(documentId: string): Promise<{
  projectId: string | null;
  ok: boolean;
}> {
  const admin = createAdminClient();

  // Single conditional UPDATE decides who owns this document. Same shape as
  // claim_finalize, one level down: it is what stops the cron sweep from
  // double-processing a document a slow-but-alive invocation still holds.
  const { data: claimed } = await admin.rpc("claim_document", {
    p_document: documentId,
  });

  const { data: doc } = await admin
    .from("documents")
    .select(
      "id, project_id, filename, mime, storage_key, raw_text, attempts, is_synthetic, visibility",
    )
    .eq("id", documentId)
    .maybeSingle();

  if (!doc) return { projectId: null, ok: false };
  if (!claimed) {
    // Someone else holds it, or it is already done. Not an error.
    return { projectId: doc.project_id, ok: true };
  }

  try {
    // T4 handles description-only projects, whose text is already on the row.
    // T6 fills in the extraction branch; nothing else here changes.
    const text = doc.raw_text ?? (await extractText(doc));

    if (!text?.trim()) {
      throw new PermanentExtractionError(
        "No text could be extracted from this document.",
      );
    }

    /*
     * ── no_index: stored, never embedded ──────────────────────────────────
     *
     * PLACEMENT IS LOAD-BEARING, and all four of these are required:
     *
     * 1. AFTER extraction, not before. §15.2: raw_text is NEVER dropped — it
     *    is the re-chunk path and the ONLY thing that makes flipping a
     *    document back out of no_index possible. Skipping extraction would
     *    make no_index a one-way door: the bucket object can be purged by the
     *    0009 sweep, and storage_key is NULL for synthetic documents, so
     *    there would be no source to re-chunk from, ever.
     *
     * 2. BEFORE chunkText/embedBatch. That is the point — no chunks, no
     *    embeddings, no OpenAI call, nothing in the vector index.
     *
     * 3. DELETE existing chunks, not merely skip inserting them. A document
     *    flipped INTO no_index after it was already processed still has its
     *    chunk set, and search would keep citing it. Idempotent (a
     *    never-indexed document has none) and it reuses §15.3's
     *    replace-the-whole-set discipline.
     *
     * 4. status 'done', not a new status and not 'failed'. claim_finalize
     *    counts documents in ('queued','processing') as pending, so anything
     *    non-terminal here holds the project in `processing` FOREVER —
     *    claim_finalize returns false on every call and no summary is ever
     *    generated. This document is genuinely finished; it just produced no
     *    chunks. The `return` hands projectId back exactly as the success
     *    path does, so the caller still reaches maybeFinalize.
     */
    if (doc.visibility === "no_index") {
      await admin.from("chunks").delete().eq("document_id", doc.id);

      const { error: skipError } = await admin
        .from("documents")
        .update({
          status: "done",
          raw_text: text, // §15.2. The re-chunk path.
          content_hash: contentHash(text),
          error: null,
        })
        .eq("id", doc.id);

      if (skipError) {
        // 23505 is possible here for the same reason it is on the success
        // path: two documents with identical extracted text. Handled
        // identically and terminally — falling through to the generic catch
        // would set 'queued', the sweep would re-dispatch, attempts would
        // climb to 3, and stuck_documents' own `attempts < 3` filter would
        // then stop selecting it: permanently stuck, project never `ready`.
        if (skipError.code === "23505") {
          await admin
            .from("documents")
            .update({
              status: "failed",
              attempts: MAX_ATTEMPTS,
              error:
                "This document duplicates another file already attached to " +
                "this project. Remove it, or rename it if the duplication is " +
                "intentional.",
            })
            .eq("id", doc.id);
          return { projectId: doc.project_id, ok: false };
        }
        throw new Error(skipError.message);
      }

      return { projectId: doc.project_id, ok: true };
    }

    const pieces = chunkText(text);
    if (pieces.length === 0) {
      /*
       * PERMANENT, not transient. chunkText is pure, so re-running it over the
       * same raw_text returns the same empty array — every retry is guaranteed
       * to fail in exactly the same way.
       *
       * As a plain Error this took the generic retry path: back to 'queued',
       * and the project sat in 'processing' until the sweep burned all three
       * attempts. ~15 minutes in production, and FOREVER in local development,
       * where no cron runs to re-dispatch it at all.
       */
      throw new PermanentExtractionError(
        `There is too little text to index — at least ${MIN_CHUNK} characters are needed.`,
      );
    }

    const embeddings = await embedBatch(pieces);

    // §15.3: chunks are immutable. Reprocessing replaces the document's whole
    // set rather than editing rows in place.
    await admin.from("chunks").delete().eq("document_id", doc.id);

    const rows = pieces.map((chunk, i) => ({
      document_id: doc.id,
      project_id: doc.project_id,
      ordinal: i,
      text: chunk,
      embedding: toVectorOrNull(embeddings[i]),
    }));

    const { error: insertError } = await admin.from("chunks").insert(rows);
    if (insertError) throw new Error(insertError.message);

    const hash = contentHash(text);
    const { error: doneError } = await admin
      .from("documents")
      .update({
        status: "done",
        // §15.2: raw_text is NEVER dropped. It is the re-chunk and
        // model-migration path.
        raw_text: text,
        content_hash: hash,
        error: null,
      })
      .eq("id", doc.id);

    if (doneError) {
      /*
       * 23505 = documents_project_hash_idx, unique on (project_id,
       * content_hash). Two files whose EXTRACTED TEXT is identical — the same
       * PDF twice, or a .docx and a .pdf of the same document.
       *
       * This must NOT fall through to the generic catch below. That would set
       * the document back to 'queued', the sweep would re-dispatch it, the
       * identical conflict would recur, attempts would climb to 3, and then
       * stuck_documents' own `attempts < 3` filter would stop selecting it —
       * permanently stuck in a non-terminal state, project never `ready`, and
       * no error visible anywhere in the UI.
       *
       * It is a semantic outcome, not a transient failure, so it terminates.
       */
      if (doneError.code === "23505") {
        // These chunks belong to a document that will not be `done`; leaving
        // them would let search cite a source the project does not show.
        await admin.from("chunks").delete().eq("document_id", doc.id);

        const { data: twin } = await admin
          .from("documents")
          .select("filename")
          .eq("project_id", doc.project_id)
          .eq("content_hash", hash)
          .neq("id", doc.id)
          .maybeSingle();

        await admin
          .from("documents")
          .update({
            status: "failed",
            attempts: MAX_ATTEMPTS, // belt and braces against the sweep
            error:
              "Duplicate content — the same text is already attached to this project" +
              (twin ? ` as "${twin.filename}".` : "."),
          })
          .eq("id", doc.id);

        // ok:false, but the caller still runs maybeFinalize: this document is
        // no longer pending, so the project finalizes from the rest.
        return { projectId: doc.project_id, ok: false };
      }
      throw new Error(doneError.message);
    }

    return { projectId: doc.project_id, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // `doc` was read AFTER claim_document incremented attempts, so this value
    // already counts the attempt in progress. Adding 1 here would burn a third
    // of the retry budget: the document would be marked failed on the 2nd try.
    const attempts = doc.attempts ?? 0;

    // A malformed file cannot be fixed by running again. Retrying it burns
    // three cron cycles AND holds the whole project in `processing` for ~15
    // minutes before the rest can finalize.
    const permanent = isPermanentExtractionError(error);

    // Back to 'queued' below the retry ceiling so the cron sweep picks it up.
    // stuck_documents() selects BOTH 'queued' and 'processing' for exactly this
    // reason — the PRD's version only selected 'processing', which meant a
    // document that failed once was never retried and its project never
    // finalized.
    await admin
      .from("documents")
      .update({
        status: permanent || attempts >= MAX_ATTEMPTS ? "failed" : "queued",
        ...(permanent ? { attempts: MAX_ATTEMPTS } : {}),
        error: message.slice(0, 2000),
      })
      .eq("id", doc.id);

    return { projectId: doc.project_id, ok: false };
  }
}
