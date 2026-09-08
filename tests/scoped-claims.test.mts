import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLAIMS,
  CLAIM_LABELS,
  PRESETS,
  SCOPED_CLAIMS,
  GRANT_PRESETS,
  isScopedClaim,
  can,
  type Claim,
} from "@/lib/auth/claim-set";

const MIGRATION = "supabase/migrations/0018_project_grants.sql";

/**
 * Authorization had ZERO test coverage before this file, despite `can()` being
 * the only authorization predicate in the codebase.
 */

test("can() denies a null user for every claim", () => {
  for (const claim of CLAIMS) {
    assert.equal(can(null, claim), false, claim);
  }
});

/**
 * THE super-admin property. `has_claim()` short-circuits on is_super_admin in
 * SQL and `can()` does the same in TS, which is why a super admin correctly
 * holds ZERO rows in user_claims — and, now, zero rows in project_grants.
 * Empty is not missing privileges. This is a genuine regression risk every
 * time a claim is added, and it had no test.
 */
test("a super admin with no claim rows passes every claim", () => {
  const superAdmin = { isSuperAdmin: true, claims: new Set<Claim>() };
  for (const claim of CLAIMS) {
    assert.ok(can(superAdmin, claim), claim);
  }
});

test("an ordinary user passes only the claims they hold", () => {
  const viewer = {
    isSuperAdmin: false,
    claims: new Set<Claim>(["projects:view"]),
  };
  assert.ok(can(viewer, "projects:view"));
  assert.ok(!can(viewer, "projects:update"));
  assert.ok(!can(viewer, "projects:view-client-info"));
  assert.ok(!can(viewer, "projects:set-nda"));
});

test("every claim has a label", () => {
  for (const claim of CLAIMS) {
    assert.equal(typeof CLAIM_LABELS[claim], "string", claim);
    assert.ok(CLAIM_LABELS[claim].length > 0, claim);
  }
  assert.equal(Object.keys(CLAIM_LABELS).length, CLAIMS.length);
});

test("every preset bundles only real claims", () => {
  for (const [name, bundle] of Object.entries(PRESETS)) {
    for (const claim of bundle) {
      assert.ok((CLAIMS as readonly string[]).includes(claim), `${name}: ${claim}`);
    }
  }
});

/**
 * Client identity and disclosure terms must be deliberate grants, never a side
 * effect of picking a convenience bundle.
 */
test("no preset confers client info or NDA authority", () => {
  for (const [name, bundle] of Object.entries(PRESETS)) {
    const b = bundle as readonly string[];
    assert.ok(!b.includes("projects:view-client-info"), name);
    assert.ok(!b.includes("projects:set-nda"), name);
  }
});

// ── Scoped claims ──────────────────────────────────────────────────────────

test("SCOPED_CLAIMS is a subset of CLAIMS", () => {
  for (const claim of SCOPED_CLAIMS) {
    assert.ok(
      (CLAIMS as readonly string[]).includes(claim),
      `${claim} is not a real claim — a typo here would silently never match a grant row`,
    );
  }
});

/**
 * Negative assertions, documenting decisions rather than mechanics.
 *
 * projects:create is unscopeable in principle: a grant names an EXISTING
 * project. projects:delete is excluded by decision — highest blast radius,
 * and soft_delete_project was the worst pre-existing gap in the schema.
 */
test("create, delete, client-info and NDA are NOT grantable per project", () => {
  for (const claim of [
    "projects:create",
    "projects:delete",
    "projects:view-client-info",
    "projects:set-nda",
    "users:update",
    "tags:manage",
  ] as const) {
    assert.ok(
      !(SCOPED_CLAIMS as readonly string[]).includes(claim),
      `${claim} must not be grantable per project`,
    );
  }
});

test("isScopedClaim narrows only scoped members", () => {
  for (const claim of SCOPED_CLAIMS) assert.ok(isScopedClaim(claim));
  assert.ok(!isScopedClaim("projects:delete"));
  assert.ok(!isScopedClaim("projects:create"));
});

/**
 * The write-only-cannot-read footgun, encoded as an executable invariant.
 *
 * A grant of projects:update WITHOUT projects:view produces a user whose
 * UPDATE passes projects_update_scoped and then fails the post-image SELECT
 * check with a confusing RLS error. No table constraint can express that
 * cross-row invariant, so the bundles are what prevent it.
 */
test("every grant preset includes projects:view", () => {
  for (const [name, bundle] of Object.entries(GRANT_PRESETS)) {
    assert.ok(
      (bundle as readonly string[]).includes("projects:view"),
      `${name} must include projects:view, or it creates a write-only user`,
    );
  }
});

test("every grant preset contains only scoped claims", () => {
  for (const [name, bundle] of Object.entries(GRANT_PRESETS)) {
    for (const claim of bundle) {
      assert.ok(
        (SCOPED_CLAIMS as readonly string[]).includes(claim),
        `${name}: ${claim}`,
      );
    }
  }
});

/**
 * THE DRIFT TEST — the highest-value assertion in this file.
 *
 * Same pattern as alias-key.test.mts: a rule whose authority lives in SQL,
 * asserted from TS. A CHECK constraint alone cannot catch TS believing a claim
 * is grantable when SQL rejects it; that surfaces as an opaque 23514 nowhere
 * near the cause.
 */
test("SCOPED_CLAIMS matches project_grants_claim_check in migration 0018", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const block = sql.match(/project_grants_claim_check check \(([\s\S]*?)\)\s*\)/);
  const list = block?.[1];
  assert.ok(list, "could not locate project_grants_claim_check in 0018");

  const fromSql = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? "");

  assert.deepEqual(
    [...fromSql].sort(),
    [...SCOPED_CLAIMS].sort(),
    "the SQL CHECK and SCOPED_CLAIMS have drifted",
  );
});

/**
 * THE SHAPE TEST — the only automatable defence against the correlated-
 * subquery regression, whose failure mode is silent and ~1000x.
 *
 * Every scoped policy must use the UNCORRELATED `in (select project_id from
 * project_grants ...)` form. An `exists (...)` referencing the outer row
 * becomes a per-row SubPlan and abandons the index while returning identical
 * results.
 */
test("every scoped policy uses the uncorrelated in (...) form", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  // Each `create policy <name>_scoped ... ;` statement.
  const scoped = [
    ...sql.matchAll(/create policy (\w+_scoped)[\s\S]*?;\n/g),
  ];
  assert.ok(scoped.length >= 10, `expected many scoped policies, got ${scoped.length}`);

  for (const [body, name] of scoped) {
    assert.ok(
      body.includes("in (select project_id from project_grants"),
      `${name} must use the uncorrelated in (...) form`,
    );
    assert.ok(
      !/exists\s*\(\s*select/i.test(body),
      `${name} must NOT use exists() — it correlates and abandons the index`,
    );
  }
});

/**
 * Every table dropped from a policy must get a replacement, or the table is
 * left with NO policy for that command and RLS denies everything.
 */
test("every dropped policy is recreated", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const dropped = [...sql.matchAll(/drop policy if exists (\w+) on/g)].map(
    (m) => m[1] ?? "",
  );
  const created = [...sql.matchAll(/create policy (\w+) on/g)].map((m) => m[1] ?? "");

  assert.ok(dropped.length > 0);
  for (const name of dropped) {
    assert.ok(
      created.includes(`${name}_global`) || created.includes(name),
      `${name} was dropped without a replacement`,
    );
  }
});
