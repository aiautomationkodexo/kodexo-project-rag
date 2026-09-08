import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Claim, type ScopedClaim } from "./claim-set";

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
  SCOPED_CLAIMS,
  GRANT_PRESETS,
  isClaim,
  isScopedClaim,
  can,
  type Claim,
  type ScopedClaim,
  type PresetName,
  type GrantPresetName,
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Per-project authorization (migration 0018)
 *
 * `can(user, claim)` is unchanged and stays synchronous. These are SIBLINGS,
 * not replacements, and they have to be: `assertClaim` is a synchronous
 * `asserts user is CurrentUser` type predicate, and TypeScript forbids an
 * `asserts` signature on a function returning a Promise. A grant lookup is a
 * query. So the scoped versions cannot be overloads of the flat ones.
 *
 * That costs nothing in practice: every call site already does
 * `const user = await getCurrentUser(); if (!user) return ...` first, so the
 * narrowing `assertClaim` provided was already done by the time these run.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The set of project ids for which the current user holds `claim` as a GRANT.
 *
 * Wrapped in React `cache()` keyed on `claim`, so a render asking about
 * several projects with the same claim pays ONE query — which is the shape a
 * list page actually has. Deliberately NOT keyed on projectId: that would be
 * one query per project, an N+1 across a list.
 *
 * A scoped user is expected to hold a handful of grants. If that assumption
 * ever breaks, the fix is to push the filter into the query (RLS already does
 * this) rather than to paginate this set.
 */
const grantsFor = cache(async (claim: ScopedClaim): Promise<Set<string>> => {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId || typeof userId !== "string") return new Set();

  /*
   * The `.eq("user_id", ...)` filter is NOT redundant, and omitting it is a
   * real bug rather than a missed optimisation.
   *
   * grants_select_self would already scope this read to the current user —
   * but a `users:view` holder ALSO matches grants_select_admin, and the two
   * policies are OR'd. Such a user would read EVERYONE's grants and compute a
   * wrong answer for themselves. In practice `can()` short-circuits before
   * this runs for most of them, but not for a users:view holder who lacks a
   * global projects:view.
   */
  const { data: rows } = await supabase
    .from("project_grants")
    .select("project_id")
    .eq("user_id", userId)
    .eq("claim", claim);

  return new Set((rows ?? []).map((r) => r.project_id));
});

/**
 * May this user exercise `claim` on THIS project?
 *
 * Returning true whenever `can()` is true is the code-level statement of "an
 * existing flat claim is an implicit global scope" — and it is also what makes
 * super admins work, since `can()` short-circuits on `isSuperAdmin` and a
 * super admin correctly holds ZERO rows in both claim tables.
 *
 * THE FAST PATH IS THE POINT: when `can()` is true this returns without
 * touching the database, so every existing global-claim holder pays nothing.
 * Only a genuinely scoped user issues a query.
 */
export async function canOn(
  user: CurrentUser | null,
  claim: ScopedClaim,
  projectId: string,
): Promise<boolean> {
  if (!user) return false;
  if (can(user, claim)) return true;
  const granted = await grantsFor(claim);
  return granted.has(projectId);
}

/**
 * For Server Actions. THROWS, like `assertClaim` — but is NOT a type
 * predicate, for the reason given in the block comment above.
 */
export async function assertCanOn(
  user: CurrentUser | null,
  claim: ScopedClaim,
  projectId: string,
): Promise<void> {
  if (!(await canOn(user, claim, projectId))) {
    throw new Error(`Missing permission: ${claim}`);
  }
}

/**
 * For pages that list projects. Replaces `requireClaim("projects:view")` on
 * the LIST surfaces only.
 *
 * "Has any project access at all" rather than "holds the global claim": a
 * grants-only user must reach /projects and /dashboard. An empty list is a
 * worse experience than a redirect, so the gate stays — it just asks the right
 * question now.
 *
 * NOTE this is NOT used on the project DETAIL page. There, RLS is the whole
 * answer: `getProject` returns null for an invisible project and the page
 * calls notFound(). A claim check there would redirect a scoped user away from
 * a project they can legitimately see.
 */
export async function requireProjectAccess(): Promise<CurrentUser> {
  const user = await requireUser();
  if (can(user, "projects:view")) return user;

  const granted = await grantsFor("projects:view");
  if (granted.size > 0) return user;

  redirect("/projects?error=forbidden");
}
