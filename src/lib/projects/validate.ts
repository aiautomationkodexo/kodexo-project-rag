/**
 * Validation rules shared by the client form and the server action, so the
 * rule exists in exactly one place.
 *
 * This is also half the T6 uploader seam: descriptionMinFor() already relaxes
 * the 200-char minimum once files are queued, so the dropzone only has to
 * report a count.
 */

import { MIN_CHUNK } from "@/lib/pipeline/chunk";
import { isNdaStatus } from "./disclosure";

export const TITLE_MIN = 3;
export const DESCRIPTION_MIN = 200;

/** PRD §12: description must be 200+ chars only when no files are attached. */
export function descriptionMinFor(fileCount: number): number {
  return fileCount > 0 ? 0 : DESCRIPTION_MIN;
}

/**
 * The keyed union is a FORCING FUNCTION: widening it surfaces a type error at
 * every consumer that renders errors, so a new field cannot be added to the
 * form without someone deciding where its error appears.
 */
export type FieldErrors = Partial<
  Record<
    | "title"
    | "description"
    | "engagementType"
    | "startDate"
    | "endDate"
    | "teamSize"
    | "ndaStatus",
    string
  >
>;

/**
 * The engagement vocabulary. MUST match the CHECK in migration 0012 —
 * tests/validate.test.mts asserts the two agree.
 */
export const ENGAGEMENT_TYPES = [
  "custom ai",
  "automation",
  "software product",
  "staff augmentation",
  "consulting",
] as const;

export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

/** Labels for the select. Keyed, so adding a type surfaces an error here. */
export const ENGAGEMENT_LABELS: Record<EngagementType, string> = {
  "custom ai": "Custom AI",
  automation: "Automation",
  "software product": "Software product",
  "staff augmentation": "Staff augmentation",
  consulting: "Consulting",
};

export function isEngagementType(value: string): value is EngagementType {
  return (ENGAGEMENT_TYPES as readonly string[]).includes(value);
}

/**
 * The optional metadata fields, as they arrive from FormData — every one a
 * raw string, with "" meaning "not supplied" (a cleared <input> and an absent
 * key are indistinguishable in a form post, and both mean NULL).
 */
export type ProjectMetaInput = {
  engagementType: string;
  startDate: string;
  endDate: string;
  teamSize: string;
  ndaStatus: string;
};

/** ISO date as produced by <input type="date">. Not a general date parser. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates the Part C/D fields. Split from validateProjectInput so the two
 * can be called independently — addFilesToProject touches neither, and the
 * NDA select is gated on its own claim and so may be absent from the payload.
 *
 * Mirrors the CHECK constraints in 0012/0013 rather than replacing them: the
 * database is the authority, and this exists to produce a field-level message
 * instead of an opaque 23514.
 */
export function validateProjectMeta(input: ProjectMetaInput): FieldErrors {
  const errors: FieldErrors = {};

  if (input.engagementType && !isEngagementType(input.engagementType)) {
    errors.engagementType = "Choose one of the listed engagement types.";
  }

  if (input.startDate && !ISO_DATE.test(input.startDate)) {
    errors.startDate = "Enter a valid date.";
  }
  if (input.endDate && !ISO_DATE.test(input.endDate)) {
    errors.endDate = "Enter a valid date.";
  }

  // Only meaningful when both are present and well-formed. ISO dates compare
  // correctly as strings, so no Date construction (and no timezone) is needed.
  if (
    input.startDate &&
    input.endDate &&
    !errors.startDate &&
    !errors.endDate &&
    input.endDate < input.startDate
  ) {
    errors.endDate = "The end date cannot be before the start date.";
  }

  if (input.teamSize) {
    // Digits only, checked BEFORE Number(). Number() accepts "1e3", " 4 ",
    // "0x10" and "Infinity", and the first three of those are integers — so a
    // Number.isInteger() test alone lets a hand-crafted post through to a
    // column typed `int`. The form is not the only caller.
    const n = /^\d+$/.test(input.teamSize) ? Number(input.teamSize) : NaN;
    if (!Number.isInteger(n) || n < 1) {
      errors.teamSize = "Team size must be a whole number of at least 1.";
    }
  }

  if (input.ndaStatus && !isNdaStatus(input.ndaStatus)) {
    errors.ndaStatus = "Choose one of the listed NDA statuses.";
  }

  return errors;
}

export function validateProjectInput(
  input: { title: string; description: string },
  fileCount = 0,
): FieldErrors {
  const errors: FieldErrors = {};
  const title = input.title.trim();
  const description = input.description.trim();
  const min = descriptionMinFor(fileCount);

  if (title.length < TITLE_MIN) {
    errors.title = `Title must be at least ${TITLE_MIN} characters.`;
  }
  if (description.length < min) {
    errors.description =
      `Describe the project in at least ${min} characters ` +
      `(currently ${description.length}), or attach a document.`;
  } else if (description.length > 0 && description.length < MIN_CHUNK) {
    /*
     * The unindexable middle. With files attached the 200-char minimum drops
     * to 0, but the chunker still discards anything below MIN_CHUNK as noise —
     * so a description of 1..29 characters produced a synthetic document that
     * could never yield a chunk, and the project hung in `processing`.
     *
     * The threshold is imported from the chunker rather than restated, so the
     * form can never disagree with the pipeline about what is indexable.
     */
    errors.description =
      `A description this short cannot be indexed — ${description.length} of ` +
      `${MIN_CHUNK} characters minimum. Write a little more, or clear the ` +
      `field entirely and rely on the attached documents.`;
  }

  return errors;
}
