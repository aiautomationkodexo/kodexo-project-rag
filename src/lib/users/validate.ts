import { isClaim, type Claim } from "@/lib/auth/claim-set";

/**
 * Shared by the client form and the server action, so the rule exists once —
 * mirroring src/lib/projects/validate.ts.
 */

export const NAME_MAX = 120;

export type UserFieldErrors = Partial<Record<"email" | "name" | "claims", string>>;

/**
 * Normalised exactly as scripts/seed-admin.mts does. `profiles.email` is
 * UNIQUE, so a case difference would create a second, unreachable account for
 * the same person.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately permissive. The authority on whether an address exists is
 * whether the magic link arrives; over-strict client regexes reject valid
 * addresses (plus-tags, long TLDs, unicode domains) for no benefit.
 */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateUserInput(input: {
  email: string;
  name: string;
}): UserFieldErrors {
  const errors: UserFieldErrors = {};
  const email = normalizeEmail(input.email);

  if (!email) errors.email = "An email address is required.";
  else if (!isPlausibleEmail(email)) errors.email = "That does not look like an email address.";

  if (input.name.trim().length > NAME_MAX) {
    errors.name = `Name must be ${NAME_MAX} characters or fewer.`;
  }

  return errors;
}

/** Narrows the raw `claim` values submitted by the form. */
export function parseClaims(values: string[]): Claim[] {
  return [...new Set(values.filter(isClaim))];
}
