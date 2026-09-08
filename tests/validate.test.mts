import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateProjectMeta,
  ENGAGEMENT_TYPES,
  ENGAGEMENT_LABELS,
  isEngagementType,
  type ProjectMetaInput,
} from "@/lib/projects/validate";

/** Every field empty — the shape a form posts when nobody fills anything in. */
const EMPTY: ProjectMetaInput = {
  engagementType: "",
  startDate: "",
  endDate: "",
  teamSize: "",
  ndaStatus: "",
};

const meta = (over: Partial<ProjectMetaInput> = {}) =>
  validateProjectMeta({ ...EMPTY, ...over });

/**
 * All five fields are optional, so the all-empty case must be VALID. Getting
 * this wrong would make every existing project unsaveable through the edit
 * form, which is the kind of thing that only shows up in manual QA.
 */
test("all fields empty is valid — every one is optional", () => {
  assert.deepEqual(meta(), {});
});

test("a fully populated, coherent payload is valid", () => {
  assert.deepEqual(
    meta({
      engagementType: "custom ai",
      startDate: "2025-01-01",
      endDate: "2025-06-30",
      teamSize: "4",
      ndaStatus: "Brand Name Use Only",
    }),
    {},
  );
});

test("engagement type must come from the vocabulary", () => {
  for (const t of ENGAGEMENT_TYPES) {
    assert.deepEqual(meta({ engagementType: t }), {}, t);
  }
  assert.ok(meta({ engagementType: "Custom AI" }).engagementType, "wrong case");
  assert.ok(meta({ engagementType: "retainer" }).engagementType, "not a member");
});

test("dates must be ISO and end cannot precede start", () => {
  assert.ok(meta({ startDate: "01/02/2025" }).startDate);
  assert.ok(meta({ endDate: "not-a-date" }).endDate);

  // The ordering rule.
  assert.ok(
    meta({ startDate: "2025-06-30", endDate: "2025-01-01" }).endDate,
    "end before start must be rejected",
  );
  // Equal dates are legal — a one-day engagement.
  assert.deepEqual(meta({ startDate: "2025-03-04", endDate: "2025-03-04" }), {});
});

/**
 * Mirrors the CHECK in 0012, which permits an end date with no start date.
 * We may know when something shipped and not when it began.
 */
test("either date alone is valid", () => {
  assert.deepEqual(meta({ startDate: "2025-01-01" }), {});
  assert.deepEqual(meta({ endDate: "2025-01-01" }), {});
});

test("team size must be a whole number of at least 1", () => {
  assert.deepEqual(meta({ teamSize: "1" }), {});
  assert.deepEqual(meta({ teamSize: "250" }), {});

  for (const bad of ["0", "-3", "2.5", "abc", "1e3", " ", "Infinity", "NaN"]) {
    assert.ok(meta({ teamSize: bad }).teamSize, `${bad} must be rejected`);
  }
});

test("NDA status must come from the vocabulary", () => {
  assert.deepEqual(meta({ ndaStatus: "Permanently Excluded" }), {});
  assert.deepEqual(meta({ ndaStatus: "NDA Hold — Nothing Can Be Used" }), {});
  // Hyphen instead of the U+2014 em dash.
  assert.ok(meta({ ndaStatus: "NDA Hold - Nothing Can Be Used" }).ndaStatus);
});

test("independent fields produce independent errors", () => {
  const errors = meta({ engagementType: "nope", teamSize: "0" });
  assert.ok(errors.engagementType);
  assert.ok(errors.teamSize);
  assert.equal(errors.startDate, undefined);
});

test("every engagement type has a label", () => {
  for (const t of ENGAGEMENT_TYPES) {
    assert.equal(typeof ENGAGEMENT_LABELS[t], "string");
    assert.ok(ENGAGEMENT_LABELS[t].length > 0, t);
  }
  assert.equal(Object.keys(ENGAGEMENT_LABELS).length, ENGAGEMENT_TYPES.length);
});

test("isEngagementType narrows only exact members", () => {
  for (const t of ENGAGEMENT_TYPES) assert.ok(isEngagementType(t));
  for (const bad of ["", "consulting ", "Consulting"]) {
    assert.ok(!isEngagementType(bad), bad);
  }
});

/**
 * The drift test, as in alias-key and disclosure: the authority for this
 * vocabulary is the CHECK constraint in SQL.
 */
test("ENGAGEMENT_TYPES matches the CHECK constraint in migration 0012", () => {
  const sql = readFileSync("supabase/migrations/0012_project_fields.sql", "utf8");
  const block = sql.match(/engagement_type in\s*\(([\s\S]*?)\)/);
  const list = block?.[1];
  assert.ok(list, "could not locate the engagement_type CHECK list in 0012");

  const fromSql = [...list.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
    (m[1] ?? "").replace(/''/g, "'"),
  );

  assert.deepEqual(
    [...fromSql].sort(),
    [...ENGAGEMENT_TYPES].sort(),
    "the SQL CHECK and ENGAGEMENT_TYPES have drifted",
  );
});
