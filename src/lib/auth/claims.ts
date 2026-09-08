import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Claim } from "./claim-set";

/**
 * Authorization is claims-only (PRD §9, invariant §15.1).
 *
 * There is no role table, no role column, and no role string anywhere in this
 * system. `is_super_admin` is the single flag, and it short-circuits `can()` to
 * true so claims added later are covered without touching any call site.
 */

export {
  CLAIMS,
  PRESETS,
  CLAIM_LABELS,
  isClaim,
  can,
  type Claim,
  type PresetName,
  type ClaimHolder,
} from "./claim-set";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  isSuperAdmin: boolean;
  claims: Set<Claim>;
};

/**
 * The signed-in, ACTIVE user, or null.
 *
 * Wrapped in React `cache()`, so the underlying query runs at most once per
 * render pass no matter how many components ask.
 *
 * This is where the `is_active` / `deleted_at` check lives — deliberately NOT
 * in the proxy. The proxy runs on every request including link prefetches, so a
 * database call there would fire on hover; Next's auth guide says to keep proxy
 * checks optimistic and avoid database checks. Putting it here still satisfies
 * the PRD's requirement that deactivation take effect on the next navigation.
 *
 * Uses the USER's client, not the admin client, so RLS is a second check on the
 * profile read.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();

  // Locally verified (WebCrypto against a cached JWKS) — no network round-trip.
  // Three-way union: check data?.claims, never !error.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId || typeof userId !== "string") return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name, is_active, is_super_admin, deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || !profile.is_active || profile.deleted_at !== null) {
    return null;
  }

  const { data: claimRows } = await supabase
    .from("user_claims")
    .select("claim")
    .eq("user_id", userId);

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    isSuperAdmin: profile.is_super_admin,
    claims: new Set((claimRows ?? []).map((r) => r.claim as Claim)),
  };
});

/** For pages. Redirects when there is no active session. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    // A Server Component cannot set cookies, so it cannot sign anyone out.
    // Route through the signout handler, which clears the session and lands on
    // /login with an explanation. This is what makes deactivation immediate.
    redirect("/auth/signout?reason=deactivated");
  }
  return user;
}

/** For pages. Redirects when the claim is missing. */
export async function requireClaim(claim: Claim): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, claim)) {
    redirect("/projects?error=forbidden");
  }
  return user;
}

/**
 * For Server Actions. THROWS — it does not redirect.
 *
 * Every action must call this itself. The proxy is not a substitute: a matcher
 * change or a refactor that moves an action to a different route can silently
 * remove proxy coverage, and Server Actions are independently addressable
 * endpoints regardless.
 */
export function assertClaim(
  user: CurrentUser | null,
  claim: Claim,
): asserts user is CurrentUser {
  if (!can(user, claim)) {
    throw new Error(`Missing permission: ${claim}`);
  }
}
