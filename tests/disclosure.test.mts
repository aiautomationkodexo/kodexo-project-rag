import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  disclosure,
  mayDiscloseExternally,
  isNdaStatus,
  NDA_STATUSES,
} from "@/lib/projects/disclosure";

/**
 * NDA disclosure is the one piece of pure logic in this system whose failure
 * mode is a legal problem rather than a bug report, so it gets the most
 * thorough test in the suite.
 *
 * The load-bearing property is FAIL CLOSED: anything not explicitly known to
 * be disclosable must resolve to {false, false}.
 */

test("the three disclosable statuses map exactly", () => {
  assert.deepEqual(disclosure("Brand Name Use + Client Name Use"), {
    mayUseBrand: true,
    mayUseClientName: true,
  });
  assert.deepEqual(disclosure("Brand Name Use Only"), {
    mayUseBrand: true,
    mayUseClientName: false,
  });
  assert.deepEqual(disclosure("Client Name Use Only"), {
    mayUseBrand: false,
    mayUseClientName: true,
  });
});

test("every restrictive status denies both", () => {
  const restrictive = [
    "Nothing Can Be Used",
    "NDA Hold — Nothing Can Be Used",
    "Pending BD/Legal Clearance",
    "Permanently Excluded",
    "Internal Only — Never External",
    "Needs Review",
    "Select",
  ];

  for (const status of restrictive) {
    assert.deepEqual(
      disclosure(status),
      { mayUseBrand: false, mayUseClientName: false },
      `${status} must deny both`,
    );
  }
});

/**
 * The reason disclosure() takes `string | null` rather than NdaStatus. A
 * project created before the column existed has NULL, and it must behave
 * exactly like 'Permanently Excluded'.
 */
test("fails closed on null, empty and unrecognised values", () => {
  const unknown = [
    null,
    "",
    " ",
    "Select ", // trailing space — a real risk from a hand-edited form value
    "brand name use only", // wrong case
    "Brand Name Use", // truncated
    "NDA Hold - Nothing Can Be Used", // HYPHEN, not the U+2014 em dash
    "Yes",
    "true",
    "__proto__",
  ];

  for (const status of unknown) {
    assert.deepEqual(
      disclosure(status),
      { mayUseBrand: false, mayUseClientName: false },
      `${JSON.stringify(status)} must fail closed`,
    );
  }
});

/**
 * Guards the invariant that makes the switch safe to extend: every entry in
 * the vocabulary is handled somewhere. A status added to NDA_STATUSES but not
 * to the switch still fails closed (that is the point of `default`), so this
 * test does not fail — it exists to prove the weaker, sufficient property that
 * nothing in the vocabulary throws or returns a malformed shape.
 */
test("every vocabulary entry returns a well-formed pair", () => {
  for (const status of NDA_STATUSES) {
    const d = disclosure(status);
    assert.equal(typeof d.mayUseBrand, "boolean", status);
    assert.equal(typeof d.mayUseClientName, "boolean", status);
  }
});

/**
 * Exactly three of ten are disclosable. Pinned as a number so that adding a
 * disclosable status is a deliberate, visible edit to this test rather than a
 * silent widening of what may be published.
 */
test("exactly three statuses permit any disclosure", () => {
  const disclosable = NDA_STATUSES.filter((s) => mayDiscloseExternally(s));
  assert.equal(disclosable.length, 3);
  assert.deepEqual([...disclosable].sort(), [
    "Brand Name Use + Client Name Use",
    "Brand Name Use Only",
    "Client Name Use Only",
  ]);
});

test("mayDiscloseExternally is the OR of the two flags", () => {
  for (const status of [...NDA_STATUSES, null, "nonsense"]) {
    const d = disclosure(status);
    assert.equal(mayDiscloseExternally(status), d.mayUseBrand || d.mayUseClientName);
  }
});

test("isNdaStatus narrows only exact vocabulary members", () => {
  for (const status of NDA_STATUSES) {
    assert.ok(isNdaStatus(status), status);
  }
  for (const bad of ["", "Select ", "nothing can be used", "Other"]) {
    assert.ok(!isNdaStatus(bad), bad);
  }
});

/**
 * The drift test, following tests/alias-key.test.mts: a rule whose authority
 * lives in SQL, asserted from TS.
 *
 * The CHECK in 0013 and NDA_STATUSES must agree BYTE FOR BYTE. The em dashes
 * are U+2014; a hyphen here would mean the form offers a value the database
 * rejects, and the failure would surface as an opaque 23514 on save rather
 * than anywhere near this file.
 */
test("NDA_STATUSES matches the CHECK constraint in migration 0013", () => {
  const sql = readFileSync("supabase/migrations/0013_nda_status.sql", "utf8");

  // The vocabulary lives in the only `check (... in (...))` in the file.
  const block = sql.match(/nda_status in \(([\s\S]*?)\)\s*\)/);
  const list = block?.[1];
  assert.ok(list, "could not locate the nda_status CHECK list in 0013");

  const fromSql = [...list.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
    (m[1] ?? "").replace(/''/g, "'"),
  );

  assert.deepEqual(
    [...fromSql].sort(),
    [...NDA_STATUSES].sort(),
    "the SQL CHECK and NDA_STATUSES have drifted",
  );
});
