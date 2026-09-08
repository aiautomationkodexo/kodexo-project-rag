import { z } from "zod";

/**
 * Structured Outputs schemas.
 *
 * Under `strict: true` EVERY property must be required — express optionality as
 * .nullable(), never .optional(). The SDK throws otherwise.
 */

export const MetadataSchema = z.object({
  /** Validated against the DB industry list afterwards; falls back to 'Other'. */
  industry: z.string(),
  industry_confidence: z.number(),
  /** Names actually used. No versions, no generic terms like "web app". */
  tech: z.array(z.string()),
});

export type ExtractedMetadata = z.infer<typeof MetadataSchema>;

export const SummarySchema = z.object({
  sections: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      content: z.string(),
    }),
  ),
});

export type GeneratedSummary = z.infer<typeof SummarySchema>;

/**
 * Features delivered and proof points, extracted in ONE call (migration 0017).
 *
 * `metric` and `source_filename` are `.nullable()` and NOT `.optional()` —
 * under `strict: true` every property must be required, and the SDK throws on
 * an optional one. They are the two fields that are genuinely absent
 * sometimes: a qualitative outcome has no figure, and the model cannot always
 * identify which corpus block a quote came from.
 *
 * `source_filename` is a STRING, not a uuid. The model is shown the corpus as
 * `--- filename (role) ---` blocks and can only name what it was shown;
 * resolving that to a document id is the caller's job, and a name matching
 * nothing resolves to null rather than failing the whole extraction.
 */
export const OutcomesSchema = z.object({
  features: z.array(
    z.object({
      /** Short noun phrase — "Real-time load assignment", not "we built X". */
      name: z.string(),
      /** One or two sentences of plain prose. */
      description: z.string(),
    }),
  ),
  proof_points: z.array(
    z.object({
      /** The quantified outcome, stated as a claim. */
      claim: z.string(),
      /** The isolated figure, or null when the outcome is qualitative. */
      metric: z.string().nullable(),
      /** VERBATIM corpus text supporting the claim. */
      evidence_quote: z.string(),
      /** Exactly as it appears in the corpus block header, or null. */
      source_filename: z.string().nullable(),
    }),
  ),
});

export type ExtractedOutcomes = z.infer<typeof OutcomesSchema>;
