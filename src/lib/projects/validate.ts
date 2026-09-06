/**
 * Validation rules shared by the client form and the server action, so the
 * rule exists in exactly one place.
 *
 * This is also half the T6 uploader seam: descriptionMinFor() already relaxes
 * the 200-char minimum once files are queued, so the dropzone only has to
 * report a count.
 */

import { MIN_CHUNK } from "@/lib/pipeline/chunk";

export const TITLE_MIN = 3;
export const DESCRIPTION_MIN = 200;

/** PRD §12: description must be 200+ chars only when no files are attached. */
export function descriptionMinFor(fileCount: number): number {
  return fileCount > 0 ? 0 : DESCRIPTION_MIN;
}

export type FieldErrors = Partial<Record<"title" | "description", string>>;

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
