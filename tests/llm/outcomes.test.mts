import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOutcomes } from "@/lib/ai/openai";

/**
 * Features and proof points against the live model (migration 0017).
 *
 * Fixtures are lifted from additive-summary.test.mts deliberately: they
 * already carry everything this needs — a named client organisation
 * ("Northwind Freight"), a named individual speaker ("Marieke de Vries"),
 * quantified outcomes (240 → 310 drivers, eleven minutes → under two), and a
 * verbatim testimonial. Reusing them means the two LLM tests exercise the
 * same corpus through different prompts.
 *
 * ── Why the assertions are STRUCTURAL ──────────────────────────────────────
 * As in additive-summary: the model's wording differs every run, so asserting
 * on prose would flake and would train whoever hits the flake to loosen the
 * test until it checks nothing. What must hold is structural — a non-empty
 * list, a metric that contains a digit, a quote that appears in the source.
 *
 * ── ⚠ ONE TEST HERE IS KNOWINGLY FLAKY, AND THAT IS THE POINT ─────────────
 *   "no client name appears anywhere" asserts a PROBABILISTIC property of a
 *   language model, not a deterministic property of our code. It will fail
 *   occasionally. That is not a bug in the test and it is not a reason to
 *   delete or weaken it: it is the honest, visible form of the limitation
 *   migration 0017 records in SQL — the prompt rule is a mitigation, not a
 *   control, because raw_text genuinely contains those names.
 *
 *   If it fails, the correct responses are to re-run it, or to strengthen
 *   OUTCOMES_SYSTEM rule 8. Loosening the assertion converts a known
 *   limitation into a hidden one.
 */

const RUN = process.env.RUN_LLM_TESTS === "1";
const skip = RUN ? false : "set RUN_LLM_TESTS=1 (calls the live OpenAI API)";

const TITLE = "Northwind Freight Portal";

const DESCRIPTION = `
Northwind Freight needed to replace a twenty-year-old dispatch system that ran
on a single Windows server in their Rotterdam depot. We built a web portal on
Next.js and PostgreSQL, hosted on AWS, that lets dispatchers assign loads to
drivers in real time. The rollout covered 240 drivers across four depots.
Migration ran over a single weekend in March 2024 with no loss of historical
consignment data. Average dispatch time fell from eleven minutes to under two.
`.trim();

const TESTIMONIAL = `
"The new portal paid for itself in the first quarter. What used to take my
dispatchers most of the morning now happens before the first coffee. I have not
had a single driver call me about a missing load since we switched."

— Marieke de Vries, Operations Director, Northwind Freight
`.trim();

const RETROSPECTIVE = `
Post-launch review, September 2024. Worth correcting the record: the rollout
ultimately covered 310 drivers, not the 240 we scoped for — two additional
depots in Antwerp were folded into the same programme in June after the initial
launch went well. The weekend migration window remains accurate.
`.trim();

/** The corpus shape finalizeProject builds, block headers included. */
const CORPUS = [
  `--- description (project description) ---\n${DESCRIPTION}`,
  `--- testimonial.md (client testimonial) ---\n${TESTIMONIAL}`,
  `--- retro.md (post-launch review) ---\n${RETROSPECTIVE}`,
].join("\n\n");

const FILENAMES = ["description", "testimonial.md", "retro.md"];

test("extracts features and proof points from a real corpus", { skip }, async (t) => {
  const outcomes = await extractOutcomes({ title: TITLE, corpus: CORPUS });

  // ── Features ────────────────────────────────────────────────────────────
  assert.ok(
    outcomes.features.length > 0,
    "a corpus describing a delivered dispatch portal produced no features",
  );

  for (const feature of outcomes.features) {
    assert.ok(feature.name.trim(), "a feature came back with a blank name");
    assert.ok(
      feature.description.trim(),
      `feature "${feature.name}" came back with a blank description`,
    );
  }

  // Rule 3: infrastructure and generic capability are not features. The
  // corpus names Next.js, PostgreSQL and AWS explicitly, so this is a real
  // temptation rather than a hypothetical one.
  for (const feature of outcomes.features) {
    assert.doesNotMatch(
      feature.name,
      /^(postgresql|next\.js|aws|rest api|cloud hosting|responsive design|web app|database)$/i,
      `"${feature.name}" is infrastructure, not a feature a user can use ` +
        `(rule 3)`,
    );
  }

  t.diagnostic(`features: ${outcomes.features.map((f) => f.name).join(" | ")}`);

  // ── Proof points ────────────────────────────────────────────────────────
  assert.ok(
    outcomes.proof_points.length > 0,
    "a corpus with 310 drivers, an eleven-to-two-minute drop and a " +
      "testimonial produced no proof points",
  );

  for (const point of outcomes.proof_points) {
    assert.ok(point.claim.trim(), "a proof point came back with a blank claim");
    assert.ok(
      point.evidence_quote.trim(),
      `proof point "${point.claim}" has no evidence quote (rule 4)`,
    );
  }

  // Rule 5: at least one quantified figure, and it must contain a digit —
  // "significant improvement" in the metric field is a rule-5 violation.
  const metrics = outcomes.proof_points
    .map((p) => p.metric)
    .filter((m): m is string => !!m?.trim());

  assert.ok(
    metrics.some((m) => /\d/.test(m)),
    `no metric contained a digit, from: ${JSON.stringify(metrics)}`,
  );

  // Rule 6: a reported source filename must be one we actually showed. A name
  // outside this set is invention, which resolves to null in the mapper and
  // silently loses the attribution.
  for (const point of outcomes.proof_points) {
    if (point.source_filename) {
      assert.ok(
        FILENAMES.includes(point.source_filename),
        `source_filename "${point.source_filename}" is not one of the ` +
          `filenames in the corpus (rule 6)`,
      );
    }
  }

  t.diagnostic(
    `proof points: ${outcomes.proof_points
      .map((p) => `${p.claim} [${p.metric ?? "no metric"}]`)
      .join(" | ")}`,
  );
});

/**
 * Rule 4 — the quote is VERBATIM.
 *
 * Asserted on a distinctive, name-free fragment so rule 8's substitution
 * cannot interfere: "before the first coffee" appears nowhere else, contains
 * no client name, and a paraphrase ("early in the morning") would not match.
 * That combination is what makes it a usable anchor.
 */
test("at least one evidence quote is genuinely verbatim", { skip }, async () => {
  const outcomes = await extractOutcomes({ title: TITLE, corpus: CORPUS });

  const quotes = outcomes.proof_points
    .map((p) => p.evidence_quote.toLowerCase())
    .join("\n");

  assert.ok(
    quotes.includes("before the first coffee") ||
      quotes.includes("paid for itself") ||
      quotes.includes("eleven minutes"),
    "no proof point reproduced a recognisable fragment of the source — " +
      "rule 4 requires verbatim quoting, and a fully paraphrased evidence " +
      "field makes a proof point unverifiable:\n" +
      quotes,
  );
});

/**
 * Rule 8 — the blanket no-client-name rule.
 *
 * ⚠ KNOWINGLY FLAKY. See the file header. Read the failure message before
 *   touching the assertion.
 */
test("no client or personal name appears in either list", { skip }, async () => {
  const outcomes = await extractOutcomes({ title: TITLE, corpus: CORPUS });

  const everything = [
    ...outcomes.features.flatMap((f) => [f.name, f.description]),
    ...outcomes.proof_points.flatMap((p) => [
      p.claim,
      p.metric ?? "",
      p.evidence_quote,
    ]),
  ]
    .join("\n")
    .toLowerCase();

  for (const name of ["northwind", "marieke", "de vries"]) {
    assert.ok(
      !everything.includes(name),
      `"${name}" leaked into an extracted field.\n\n` +
        `Rule 8 is a MITIGATION, NOT A CONTROL — an occasional failure here ` +
        `is expected, and is exactly why migration 0017 refuses to call this ` +
        `a guarantee. The model receives raw_text, which genuinely contains ` +
        `this name, and evidence_quote is verbatim by design.\n\n` +
        `Correct responses: re-run, or strengthen OUTCOMES_SYSTEM rule 8. ` +
        `Do NOT loosen this assertion — that converts a known limitation ` +
        `into a hidden one.\n\nExtracted text:\n${everything}`,
    );
  }
});
