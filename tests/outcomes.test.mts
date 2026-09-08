import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toFeatureRows, toProofPointRows } from "@/lib/projects/outcomes";
import { OUTCOMES_SYSTEM } from "@/lib/ai/openai";

/**
 * Features and proof points (migration 0017).
 *
 * Three properties are tested here, and each one guards a failure that is
 * SILENT — no exception, no error row, just a wrong answer on the page:
 *
 *   1. Ordinal densification. A blank entry dropped after the index is taken
 *      leaves a gap in the ordering, which no constraint rejects.
 *   2. SQL↔TS drift. A column named differently in the migration than in the
 *      query arrives `undefined` and renders blank (§15.10).
 *   3. The no-client-name rule is BLANKET. Making it conditional would
 *      reintroduce the contradiction the summariser has to manage.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. Ordinal densification — the filter-before-map trap
// ═══════════════════════════════════════════════════════════════════════════

test("feature ordinals are gapless after blanks are dropped", () => {
  const rows = toFeatureRows("p1", [
    { name: "Real-time load assignment", description: "Dispatchers assign." },
    { name: "   ", description: "Blank name, must be dropped." },
    { name: "Driver mobile app", description: "Drivers accept loads." },
    { name: "Audit trail", description: "  " },
    { name: "Depot dashboard", description: "Per-depot throughput." },
  ]);

  assert.deepEqual(
    rows.map((r) => r.ordinal),
    [0, 1, 2],
    "ordinals must be re-densified to 0..n-1, not inherited from the " +
      "unfiltered array — a gap here renders as a hole in the display order " +
      "that nothing ever reports as an error",
  );

  assert.deepEqual(rows.map((r) => r.name), [
    "Real-time load assignment",
    "Driver mobile app",
    "Depot dashboard",
  ]);

  assert.ok(
    rows.every((r) => r.project_id === "p1"),
    "project_id must be stamped on every row",
  );
});

test("proof point ordinals are gapless after blanks are dropped", () => {
  const rows = toProofPointRows(
    "p1",
    [
      {
        claim: "Dispatch time fell to under two minutes",
        metric: "11 min to under 2 min",
        evidence_quote: "Average dispatch time fell from eleven minutes.",
        source_filename: "description",
      },
      {
        claim: "  ",
        metric: null,
        evidence_quote: "Blank claim, dropped.",
        source_filename: null,
      },
      {
        claim: "Rollout reached 310 drivers",
        metric: "310",
        evidence_quote: "The rollout ultimately covered 310 drivers.",
        source_filename: "retro.md",
      },
    ],
    new Map([["description", "doc-1"]]),
  );

  assert.deepEqual(rows.map((r) => r.ordinal), [0, 1]);
  assert.equal(rows[0]?.source_document_id, "doc-1");
});

test("blank text is dropped rather than sent to a non-blank CHECK", () => {
  // Both tables carry named `length(trim(...)) > 0` constraints, so ONE empty
  // string reaches Postgres as a 23514 that fails the ENTIRE batch insert —
  // losing every good row with it. The filter is what keeps one bad entry
  // costing one entry.
  assert.deepEqual(
    toFeatureRows("p1", [{ name: "", description: "" }]),
    [],
    "an all-blank feature must not reach the insert",
  );

  assert.deepEqual(
    toProofPointRows(
      "p1",
      [{ claim: "x", metric: null, evidence_quote: "   ", source_filename: null }],
      new Map(),
    ),
    [],
    "a proof point with no evidence must not reach the insert",
  );
});

test("an unresolved source filename becomes null, never a guess", () => {
  const rows = toProofPointRows(
    "p1",
    [
      {
        claim: "Paid for itself in the first quarter",
        metric: null,
        evidence_quote: "The new portal paid for itself.",
        // A filename the model invented, matching nothing in the corpus.
        source_filename: "does-not-exist.pdf",
      },
    ],
    new Map([["description", "doc-1"]]),
  );

  assert.equal(
    rows[0]?.source_document_id,
    null,
    "an unmatched filename must resolve to null — attribution is then " +
      "omitted entirely rather than pointing at the wrong document",
  );
});

test("metric is null, never undefined", () => {
  const rows = toProofPointRows(
    "p1",
    [
      {
        claim: "Zero data loss during migration",
        metric: "   ",
        evidence_quote: "No loss of historical consignment data.",
        source_filename: null,
      },
    ],
    new Map(),
  );

  // `|| null` and never `|| undefined`: PostgREST OMITS undefined keys, which
  // on an insert applies the column default instead of writing NULL.
  assert.equal(rows[0]?.metric, null);
  assert.ok(
    "metric" in (rows[0] ?? {}),
    "the key must be present so PostgREST writes NULL explicitly",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SQL↔TS drift — following tests/disclosure.test.mts
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A column named differently in the migration than in the query does not
 * error — Supabase returns the row without it and the field arrives
 * `undefined`, which renders as blank. §15.10 calls that a silent wrong
 * answer, and this is the only thing that catches it without a live database.
 */
test("every column the app reads exists in migration 0017", () => {
  const sql = readFileSync(
    "supabase/migrations/0017_project_outcomes.sql",
    "utf8",
  );

  const featureBlock = sql.match(/create table project_features \(([\s\S]*?)\n\);/);
  const proofBlock = sql.match(
    /create table project_proof_points \(([\s\S]*?)\n\);/,
  );

  assert.ok(featureBlock?.[1], "could not locate project_features DDL");
  assert.ok(proofBlock?.[1], "could not locate project_proof_points DDL");

  for (const column of ["id", "project_id", "name", "description", "ordinal"]) {
    assert.match(
      featureBlock[1] as string,
      new RegExp(`\\n\\s+${column}\\s`),
      `project_features is missing the ${column} column the app selects`,
    );
  }

  for (const column of [
    "id",
    "project_id",
    "claim",
    "metric",
    "evidence_quote",
    "source_document_id",
    "ordinal",
  ]) {
    assert.match(
      proofBlock[1] as string,
      new RegExp(`\\n\\s+${column}\\s`),
      `project_proof_points is missing the ${column} column the app selects`,
    );
  }
});

test("0017 keeps the constraints the mappers rely on", () => {
  const sql = readFileSync(
    "supabase/migrations/0017_project_outcomes.sql",
    "utf8",
  );

  // The reason toFeatureRows/toProofPointRows filter blanks at all.
  assert.match(sql, /project_features_name_not_blank/);
  assert.match(sql, /project_proof_points_quote_not_blank/);

  // What makes a duplicate ordinal a loud 23505 instead of a silent reorder.
  assert.match(sql, /project_features_project_ordinal_key unique/);
  assert.match(sql, /project_proof_points_project_ordinal_key\s*\n?\s*unique/);

  // ON DELETE SET NULL, not CASCADE: the 0009 sweep hard-deletes documents,
  // and cascade would silently destroy extracted claims.
  assert.match(
    sql,
    /source_document_id\s+uuid references documents\(id\) on delete set null/,
    "source_document_id must be ON DELETE SET NULL",
  );

  // RLS is what makes a table created in this schema not world-readable.
  assert.match(sql, /alter table project_features enable row level security/);
  assert.match(sql, /alter table project_proof_points enable row level security/);
});

test("both new tables order by ordinal and never by created_at", () => {
  const src = readFileSync("src/lib/projects/queries.ts", "utf8");

  for (const table of ["project_features", "project_proof_points"]) {
    // The chain from `.from("<table>")` up to the end of that statement.
    const chain = src.match(
      new RegExp(`\\.from\\("${table}"\\)([\\s\\S]*?)\\),\\n`),
    );
    assert.ok(chain?.[1], `could not locate the ${table} query`);

    assert.match(
      chain[1] as string,
      /\.order\("ordinal"/,
      `${table} must order by ordinal`,
    );
    assert.doesNotMatch(
      chain[1] as string,
      /\.order\("created_at"/,
      `${table} must NOT order by created_at — a wipe-and-rebuild inserts ` +
        `every row in one statement, so now() is identical across all of ` +
        `them and the ordering is non-deterministic`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The no-client-name rule is blanket, not conditional
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CLIENT_ANONYMITY_RULE is appended to SUMMARY_SYSTEM only when
 * disclosure().mayUseClientName is false, because SUMMARY_SYSTEM rule 6
 * mandates attributed verbatim testimonials and a blanket ban would
 * contradict it — producing unpredictable PARTIAL redaction.
 *
 * OUTCOMES_SYSTEM has no such counter-rule, so its ban is unconditional. This
 * test pins that: an `extractOutcomes` that grew a `mayUseClientName`
 * parameter would have reintroduced the contradiction, and this fails first.
 */
test("the outcomes prompt bans client names unconditionally", () => {
  assert.match(OUTCOMES_SYSTEM, /NEVER name a client/);
  assert.match(OUTCOMES_SYSTEM, /Attribute speakers by ROLE/);

  const src = readFileSync("src/lib/ai/openai.ts", "utf8");
  const fn = src.match(
    /export async function extractOutcomes\(input: \{([\s\S]*?)\}\)/,
  );
  assert.ok(fn?.[1], "could not locate extractOutcomes' parameter list");
  assert.doesNotMatch(
    fn[1] as string,
    /mayUseClientName/,
    "extractOutcomes must NOT take mayUseClientName — the rule is blanket, " +
      "and gating it would recreate the summariser's rule-6 conflict",
  );
});

test("the outcomes prompt keeps the rules the schema depends on", () => {
  // Rule 5: null rather than invent a figure. `metric` is nullable BECAUSE of
  // this rule, so weakening one without the other breaks the pair.
  assert.match(OUTCOMES_SYSTEM, /NEVER invent a number/);
  // Rule 4: what makes a proof point checkable rather than an assertion.
  assert.match(OUTCOMES_SYSTEM, /VERBATIM/);
  // Rule 7: an empty array is a legal, preferred answer.
  assert.match(OUTCOMES_SYSTEM, /return \[\]/);
});
