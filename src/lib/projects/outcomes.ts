/**
 * Model output → database rows, for the two lists migration 0017 adds.
 *
 * Pure, and deliberately NOT `server-only`: extracted from finalizeProject so
 * the two traps below are unit-testable without a network or a database.
 * Nothing here touches Supabase or OpenAI.
 */

import type { ExtractedOutcomes } from "@/lib/ai/schemas";

export type FeatureInsert = {
  project_id: string;
  name: string;
  description: string;
  ordinal: number;
};

export type ProofPointInsert = {
  project_id: string;
  claim: string;
  metric: string | null;
  evidence_quote: string;
  source_document_id: string | null;
  ordinal: number;
};

/**
 * ⚠ FILTER BEFORE MAP. Both orderings compile and only one is correct.
 *
 * 1. The filter must exist at all. project_features has named non-blank CHECK
 *    constraints, so ONE model-emitted empty string raises 23514 and fails
 *    the ENTIRE batch insert — losing every good entry alongside the bad one.
 *
 * 2. The filter must run BEFORE the map that assigns `ordinal`. Mapping first
 *    takes the index from the unfiltered array, so dropping entry 3 of 6
 *    yields ordinals [0,1,2,4,5] — a gap. `unique (project_id, ordinal)`
 *    still holds, so nothing raises; the list simply renders with a hole in
 *    its ordering that no error ever reports. Filtering first re-densifies
 *    the indices to 0..n-1, which is what tests/outcomes.test.mts asserts.
 */
export function toFeatureRows(
  projectId: string,
  features: ExtractedOutcomes["features"],
): FeatureInsert[] {
  return features
    .map((f) => ({ name: f.name.trim(), description: f.description.trim() }))
    .filter((f) => f.name && f.description)
    .map((f, i) => ({
      project_id: projectId,
      name: f.name,
      description: f.description,
      ordinal: i,
    }));
}

/**
 * Same filter-then-map discipline as toFeatureRows.
 *
 * `metric` uses `|| null` and NEVER `|| undefined`: PostgREST OMITS undefined
 * keys, which on an insert applies the column default rather than writing
 * NULL. metric has no default, so the row would still be correct here — but
 * the habit is what matters, and it is wrong the moment a default is added.
 *
 * `byFilename` resolves the model's reported filename to a document id.
 * A name matching nothing yields null, which is a legal value
 * (source_document_id is nullable, ON DELETE SET NULL) and renders as no
 * attribution — never a guess.
 */
export function toProofPointRows(
  projectId: string,
  proofPoints: ExtractedOutcomes["proof_points"],
  byFilename: Map<string, string>,
): ProofPointInsert[] {
  return proofPoints
    .map((p) => ({
      claim: p.claim.trim(),
      metric: p.metric?.trim() || null,
      evidence_quote: p.evidence_quote.trim(),
      source_filename: p.source_filename?.trim() || null,
    }))
    .filter((p) => p.claim && p.evidence_quote)
    .map((p, i) => ({
      project_id: projectId,
      claim: p.claim,
      metric: p.metric,
      evidence_quote: p.evidence_quote,
      source_document_id:
        (p.source_filename && byFilename.get(p.source_filename)) || null,
      ordinal: i,
    }));
}
