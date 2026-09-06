import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  embedBatch,
  extractMetadata,
  generateSummary,
  renderSummary,
} from "@/lib/ai/openai";
import { asSummary, type Summary } from "@/lib/types";
import { toVectorOrNull } from "@/lib/supabase/vector";

/** Alias key normalisation, matching migration 0003's derivation exactly. */
function aliasKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

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

  await finalizeProject(projectId);
  return true;
}

export async function finalizeProject(projectId: string): Promise<void> {
  const admin = createAdminClient();

  try {
    const { data: project } = await admin
      .from("projects")
      .select("id, title, summary")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) return;

    const { data: documents } = await admin
      .from("documents")
      .select("id, filename, doc_role, raw_text")
      .eq("project_id", projectId)
      .eq("status", "done")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    const usable = (documents ?? []).filter((d) => d.raw_text?.trim());
    if (usable.length === 0) {
      await admin
        .from("projects")
        .update({ status: "ready" })
        .eq("id", projectId);
      return;
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
    const generated = await generateSummary({
      title: project.title,
      existing,
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
  } catch (error) {
    // §15.9: 'finalizing' is ALWAYS escaped. Every error path forces 'ready',
    // or the project is stranded in a status the UI shows as in-progress
    // forever and claim_finalize can never win again.
    console.error(`[finalize] ${projectId}:`, error);
    await admin
      .from("projects")
      .update({ status: "ready" })
      .eq("id", projectId);
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
      await admin
        .from("tech_tag_aliases")
        .upsert({ alias: aliasKey(name), tech_tag_id: created.id }, { onConflict: "alias" });
    }
  }

  return [...new Set(resolved)];
}
