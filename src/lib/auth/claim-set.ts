/**
 * The claim vocabulary and the authorization predicate.
 *
 * Deliberately NOT `server-only` — unlike `./claims.ts`, which is. A client
 * component (the claims checkbox grid) has to render the full CLAIMS list and
 * decide which boxes to disable, and it cannot import from a server-only
 * module. `claims.ts` re-exports everything here, so server code keeps using
 * the single import it always has.
 *
 * Nothing in this file touches the database or the session.
 */

export const CLAIMS = [
  "projects:view",
  "projects:create",
  "projects:update",
  "projects:delete",
  // Part B/C. Deliberately NOT in any PRESET: client identity and disclosure
  // terms are always a deliberate grant, never a side effect of picking a
  // convenience bundle.
  "projects:view-client-info",
  "projects:set-nda",
  "users:view",
  "users:create",
  "users:update",
  "users:delete",
  "tags:manage",
] as const;

export type Claim = (typeof CLAIMS)[number];

/** Convenience bundles for the user-creation form. NOT a role system (§15.1). */
export const PRESETS = {
  Viewer: ["projects:view"],
  Editor: ["projects:view", "projects:create", "projects:update"],
  Manager: [
    "projects:view",
    "projects:create",
    "projects:update",
    "projects:delete",
    "users:view",
    "users:create",
    "users:update",
    "tags:manage",
  ],
} as const satisfies Record<string, readonly Claim[]>;

export type PresetName = keyof typeof PRESETS;

/** Human labels. Keyed by claim so adding a claim surfaces a type error here. */
export const CLAIM_LABELS: Record<Claim, string> = {
  "projects:view": "View projects",
  "projects:create": "Create projects",
  "projects:update": "Edit projects",
  "projects:delete": "Delete projects",
  "projects:view-client-info": "View client information",
  "projects:set-nda": "Set NDA and disclosure status",
  "users:view": "View users",
  "users:create": "Create users",
  "users:update": "Edit users and their permissions",
  "users:delete": "Deactivate and delete users",
  "tags:manage": "Approve and merge technology tags",
};

/** Narrows an arbitrary string from FormData to a Claim. */
export function isClaim(value: string): value is Claim {
  return (CLAIMS as readonly string[]).includes(value);
}

/**
 * The claims a `project_grants` row may legally carry.
 *
 * MUST agree with project_grants_claim_check in migration 0018 —
 * tests/scoped-claims.test.mts parses the migration and asserts set equality,
 * because a claim TS thinks is grantable but SQL rejects fails as an opaque
 * 23514 nowhere near the cause.
 *
 * `projects:create` is absent because a grant names an EXISTING project.
 * `projects:delete` is absent by decision: highest blast radius, and
 * soft_delete_project was the worst pre-existing gap in the schema.
 */
export const SCOPED_CLAIMS = [
  "projects:view",
  "projects:update",
] as const satisfies readonly Claim[];

export type ScopedClaim = (typeof SCOPED_CLAIMS)[number];

export function isScopedClaim(claim: Claim): claim is ScopedClaim {
  return (SCOPED_CLAIMS as readonly Claim[]).includes(claim);
}

/**
 * Grant bundles, the per-project analogue of PRESETS.
 *
 * EVERY BUNDLE INCLUDES projects:view, and that is not cosmetic. A row
 * granting projects:update WITHOUT a matching view row produces a user who
 * can write a project they cannot read: the UPDATE passes
 * projects_update_scoped, then Postgres checks the post-image against the
 * SELECT policies (0006's mechanism) and it fails with a confusing "new row
 * violates row-level security policy". No table constraint can express that
 * cross-row invariant, so the UI grants a bundle instead.
 */
export const GRANT_PRESETS = {
  Viewer: ["projects:view"],
  Editor: ["projects:view", "projects:update"],
} as const satisfies Record<string, readonly ScopedClaim[]>;

export type GrantPresetName = keyof typeof GRANT_PRESETS;

/**
 * The subject of an authorization decision. Structurally satisfied by
 * `CurrentUser` from ./claims, but declared here so this module stays free of
 * server imports.
 */
export type ClaimHolder = {
  isSuperAdmin: boolean;
  claims: Set<Claim>;
};

/**
 * §15.1: the ONLY authorization predicate in this codebase.
 *
 * `isSuperAdmin` short-circuits to true, so claims added later are covered
 * without touching any call site — and a super admin's checkbox grid is fully
 * enabled for free.
 */
export function can(user: ClaimHolder | null, claim: Claim): boolean {
  if (!user) return false;
  return user.isSuperAdmin || user.claims.has(claim);
}
