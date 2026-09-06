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
