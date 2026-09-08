import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { aliasKey } from "@/lib/tags/alias-key";
import {
  embedBatch,
  extractMetadata,
  extractOutcomes,
  generateSummary,
  renderSummary,
} from "@/lib/ai/openai";
import { asSummary, type Summary } from "@/lib/types";
import { disclosure } from "@/lib/projects/disclosure";
import { toFeatureRows, toProofPointRows } from "@/lib/projects/outcomes";
import {
  generateCaseStudy,
  discardCaseStudy,
} from "@/lib/case-study/generate";
import { toVectorOrNull } from "@/lib/supabase/vector";
import {
  notifyProjectReady,
  type FinalizeOutcome,
} from "@/lib/email/project-ready";

/**
 * §15.6: THE ONLY finalization gate.
 *
 * claim_finalize performs a single conditional UPDATE; Postgres guarantees one
 * winner among however many invocations think they are last. There is no
 * application-level "am I last?" check anywhere in this codebase, and there
 * must never be one.
 *
 * MUST be called AFTER the document's status='done' write has committed —
 * otherwise the last worker counts itself as pending and nobody finalizes.
 * MUST also be called on the error path — a failed document is no longer
 * pending, so finalize still has to fire or the project sits in 'processing'
 * forever.
 */
export async function maybeFinalize(projectId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: won } = await admin.rpc("claim_finalize", {
    p_project: projectId,
  });
  if (!won) return false;

  const outcome = await finalizeProject(projectId);

  // ── Completion email (PRD §10) ──────────────────────────────────────────
  // Dispatched HERE, not inside finalizeProject, and that separation is the
  // entire point. §15.9 ("finalizing is ALWAYS escaped") lives inside that
  // function's try/catch; this call sits outside it and is unreachable from
  // it, so no future edit to the mail path can flip a successful finalize into
  // the error branch. notifyProjectReady is total — it never throws — which is
  // belt to this braces.
  //
  // Awaited, not fire-and-forget: a serverless invocation can freeze the moment
  // its handler returns, and a detached promise is simply lost. NOT wrapped in
  // after() either — this already runs inside the after() registered by
  // /api/process/[documentId], and nesting is unsupported.
  if (outcome !== "error") {
    await notifyProjectReady(projectId, outcome);
  }
  return true;
}

/**
 * Returns what it did, so maybeFinalize can decide whether to mail. The only
 * edits this adds inside the try/catch are `return` statements, which cannot
 * throw and so cannot disturb §15.9.
 */
export async function finalizeProject(
  projectId: string,
): Promise<FinalizeOutcome> {
  const admin = createAdminClient();

  try {
    const { data: project } = await admin
      .from("projects")
      .select("id, title, summary, nda_status")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) return "error";

    /*
     * ⚠ project_client IS DELIBERATELY NOT READ HERE, and must never be.
     *   Everything gathered below is fed verbatim to OpenAI and lands in
     *   summary_text, which IS embedded — so adding client_name to any select
     *   in this function is how the gated field enters the vector index and
     *   becomes retrievable to every projects:view holder. The admin client is
     *   in use, so RLS provides ZERO protection at this point: the absence of
     *   the join is the whole enforcement.
     *
     * The `visibility` filter is the SECOND no_index enforcement point, and
     * skipping the chunking alone is NOT sufficient. A no_index document
     * reaches status 'done' with raw_text populated (§15.2 requires that), so
     * without this filter its text would still be summarised and embedded
     * into summary_text — making "stored, never embedded" false by exactly
     * the route the chunk skip appears to have closed.
     */
    const { data: documents } = await admin
      .from("documents")
      .select("id, filename, doc_role, raw_text")
      .eq("project_id", projectId)
      .eq("status", "done")
      .eq("is_active", true)
      .neq("visibility", "no_index")
      .order("created_at", { ascending: true });

    const usable = (documents ?? []).filter((d) => d.raw_text?.trim());
    if (usable.length === 0) {
      // WIPE HERE TOO. This branch returns before the extraction block at the
      // bottom of the try, so without these two deletes a project whose last
      // document was removed keeps rendering "Features delivered" for a
      // corpus that no longer exists — stale model output presented as
      // current. The summary has the same problem and is left alone
      // deliberately: §15.8 keeps it additive and a human may have curated
      // it, whereas these rows are disposable by construction (0017).
      await admin.from("project_features").delete().eq("project_id", projectId);
      await admin
        .from("project_proof_points")
        .delete()
        .eq("project_id", projectId);

      // THE OUTLINE GOES TOO, and its Storage object with it (0018).
      //
      // Same argument as the two deletes above, with more force: this is a
      // DOWNLOADABLE FILE. A project whose last document was removed would
      // otherwise keep offering a case study describing a corpus that no
      // longer exists — and unlike a stale table on a page, that file leaves
      // the building. Deleting the row is not enough on its own; Storage does
      // not cascade from Postgres, which is the premise the whole 0009 sweep
      // rests on.
      await discardCaseStudy(projectId);

      await admin
        .from("projects")
        .update({ status: "ready" })
        .eq("id", projectId);
      return "empty";
    }

    const existing: Summary | null = asSummary(project.summary);

    // ── Metadata, additive (§15.8) ────────────────────────────────────────
    const [{ data: industryRows }, { data: existingTagRows }] = await Promise.all([
      admin.from("industries").select("name"),
      admin
        .from("project_tech_tags")
        .select("tech_tags(canonical_name)")
        .eq("project_id", projectId),
    ]);

    const industries = (industryRows ?? []).map((r) => r.name);
    const existingTags = (existingTagRows ?? [])
      .flatMap((r) => {
        const t = r.tech_tags as unknown as { canonical_name: string } | null;
        return t ? [t.canonical_name] : [];
      })
      .filter(Boolean);

    const corpus = usable
      .map(
        (d) =>
          `--- ${d.filename}${d.doc_role ? ` (${d.doc_role})` : ""} ---\n${d.raw_text}`,
      )
      .join("\n\n");

    const metadata = await extractMetadata({
      corpus,
      industries,
      existingTags,
    });

    // Validate against the DB list; fall back rather than writing a bad FK.
    const industry = industries.includes(metadata.industry)
      ? metadata.industry
      : "Other";

    // ── Tag normalisation, UPSERT ONLY (§15.8: never delete) ──────────────
    const tagIds = await resolveTags(admin, metadata.tech);
    if (tagIds.length > 0) {
      await admin.from("project_tech_tags").upsert(
        tagIds.map((tech_tag_id) => ({ project_id: projectId, tech_tag_id })),
        { onConflict: "project_id,tech_tag_id", ignoreDuplicates: true },
      );
    }

    // ── Summary, additive open sections ──────────────────────────────────
    // The NDA gate on the prompt. disclosure() fails closed, so a project with
    // no NDA answer is summarised WITHOUT permission to name the client — the
    // conservative direction, and the same default generateSummary applies if
    // the flag is omitted entirely.
    const generated = await generateSummary({
      title: project.title,
      existing,
      mayUseClientName: disclosure(project.nda_status).mayUseClientName,
      newDocuments: usable.map((d) => ({
        filename: d.filename,
        docRole: d.doc_role,
        text: d.raw_text ?? "",
      })),
    });

    const summary: Summary = { sections: generated.sections };
    const summaryText = renderSummary(summary);
    const [summaryEmbedding] = await embedBatch([summaryText]);

    // Version history FIRST — it is the rollback path for a bad regeneration.
    await admin.from("project_summaries").insert({
      project_id: projectId,
      summary,
      summary_text: summaryText,
    });

    await admin
      .from("projects")
      .update({
        summary,
        summary_text: summaryText,
        summary_embedding: toVectorOrNull(summaryEmbedding),
        industry,
        industry_confidence: metadata.industry_confidence,
        status: "ready",
      })
      .eq("id", projectId);

    // ── Features and proof points — WIPE AND REBUILD (0017) ──────────────
    //
    // LAST, and inside its OWN try/catch. Both properties are load-bearing.
    //
    // LAST because the summary is the product and this is a secondary view of
    // the same corpus: a new failure mode must not sit in front of the thing
    // that must work, and must not delay status='ready' by an extra round
    // trip. The `projects` update above has already committed.
    //
    // ⚠ THE INNER CATCH IS NOT DEFENSIVE PADDING. Without it an OpenAI 500
    //   here escapes to §15.9's catch, which forces 'ready' (fine) and
    //   returns "error" — and maybeFinalize SKIPS THE COMPLETION EMAIL on
    //   "error". So a failure in a secondary extraction would silently
    //   suppress the "project is ready" mail for a project whose summary
    //   generated perfectly, and would report an error for writes that have
    //   already committed. The catch keeps this failure local to the feature
    //   that caused it.
    //
    // ⚠ THE WIPE IS AFTER THE MODEL CALL, INSIDE THE TRY. On failure nothing
    //   is deleted, so the previously-extracted rows survive and the page
    //   shows the last good set instead of going blank. Deleting first would
    //   turn a transient 429 into permanent data loss.
    try {
      const outcomes = await extractOutcomes({
        corpus,
        title: project.title,
      });

      // filename → id, for resolving the model's source_filename. Built from
      // `usable` — the same rows that produced the corpus — so a filename the
      // model reports is either in here or was invented. Last-wins on a
      // duplicate filename: two documents CAN share a name and there is no
      // correct answer, so pick one deterministically rather than dropping
      // the attribution.
      const byFilename = new Map(usable.map((d) => [d.filename, d.id]));

      const features = toFeatureRows(projectId, outcomes.features);
      const proofPoints = toProofPointRows(
        projectId,
        outcomes.proof_points,
        byFilename,
      );

      // Safe ONLY because no row in either table is human-authored — no
      // editing UI, no is_reviewed column (0017). An edit affordance would
      // make this destructive.
      await admin.from("project_features").delete().eq("project_id", projectId);
      await admin
        .from("project_proof_points")
        .delete()
        .eq("project_id", projectId);

      if (features.length > 0) {
        const { error } = await admin.from("project_features").insert(features);
        if (error) throw new Error(error.message);
      }

      if (proofPoints.length > 0) {
        const { error } = await admin
          .from("project_proof_points")
          .insert(proofPoints);
        if (error) throw new Error(error.message);
      }
    } catch (error) {
      // Logged, NEVER rethrown. See the note above.
      console.error(`[finalize:outcomes] ${projectId}:`, error);
    }

    // ── Case study outline — GENERATE, UPLOAD, REPLACE (0018) ────────────
    //
    // LAST, and in its OWN try/catch, for exactly the reasons the outcomes
    // block above documents. Repeating the important half: an OpenAI 500 or a
    // Storage failure here must NOT escape to §15.9's catch, because that
    // returns "error" and maybeFinalize SKIPS THE COMPLETION EMAIL on
    // "error". Without this catch, a failed DOCX upload would silently
    // suppress the "your project is ready" mail for a project whose summary
    // and outcomes both generated perfectly.
    //
    // ⚠ THE CORPUS PASSED HERE IS THE SAME ONE THE SUMMARISER SAW, and that
    //   is not a convenience — it is the no_index and client-name enforcement
    //   inherited whole. `usable` is already filtered to active, done,
    //   non-no_index documents, and project_client was never joined. Building
    //   a fresh corpus query for this call is how a future edit reintroduces
    //   a no_index document into an externally-facing deliverable.
    //
    // The generated file is NEVER given a `documents` row. See 0018's header:
    // that would feed this text back into the corpus it was generated from,
    // and every regeneration would compound the distortion with nothing
    // raised anywhere.
    try {
      await generateCaseStudy({
        projectId,
        title: project.title,
        corpus,
        ndaStatus: project.nda_status,
      });
    } catch (error) {
      console.error(`[finalize:case-study] ${projectId}:`, error);
    }

    return "summarized";
  } catch (error) {
    // §15.9: 'finalizing' is ALWAYS escaped. Every error path forces 'ready',
    // or the project is stranded in a status the UI shows as in-progress
    // forever and claim_finalize can never win again.
    console.error(`[finalize] ${projectId}:`, error);
    await admin
      .from("projects")
      .update({ status: "ready" })
      .eq("id", projectId);

    return "error";
  }
}

/**
 * Maps model-emitted technology names onto canonical tags via the alias table,
 * creating UNAPPROVED tags for anything unrecognised (the T8 review queue).
 */
async function resolveTags(
  admin: ReturnType<typeof createAdminClient>,
  names: string[],
): Promise<string[]> {
  const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (cleaned.length === 0) return [];

  const keys = cleaned.map(aliasKey);
  const { data: aliases } = await admin
    .from("tech_tag_aliases")
    .select("alias, tech_tag_id")
    .in("alias", keys);

  const byKey = new Map((aliases ?? []).map((a) => [a.alias, a.tech_tag_id]));
  const resolved: string[] = [];
  const unknown: string[] = [];

  for (const name of cleaned) {
    const id = byKey.get(aliasKey(name));
    if (id) resolved.push(id);
    else unknown.push(name);
  }

  for (const name of unknown) {
    // is_approved defaults true in the schema, so set it explicitly: a
    // model-invented tag must land in the review queue, not the canon.
    const { data: created } = await admin
      .from("tech_tags")
      .upsert(
        { canonical_name: name, is_approved: false },
        { onConflict: "canonical_name" },
      )
      .select("id")
      .maybeSingle();

    if (created) {
      resolved.push(created.id);
      // ignoreDuplicates is NOT optional here. Without it PostgREST sends
      // ON CONFLICT DO UPDATE, which STEALS the alias from whatever tag
      // already owns it — orphaning that tag, and able to silently undo a
      // committed merge (0011) if this finalize read the alias table before
      // the merge and writes after it. DO NOTHING is the only safe form.
      //
      // The row is redundant anyway since 0011's tech_tags_self_alias trigger,
      // which is belt to this braces.
      await admin
        .from("tech_tag_aliases")
        .upsert(
          { alias: aliasKey(name), tech_tag_id: created.id },
          { onConflict: "alias", ignoreDuplicates: true },
        );
    }
  }

  return [...new Set(resolved)];
}
