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
