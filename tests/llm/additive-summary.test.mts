import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSummary } from "@/lib/ai/openai";
import type { Summary } from "@/lib/types";

/**
 * PRD §14's additive-summary regression test.
 *
 * §15.11: "Summary section keys are never renamed by the model. Rule 1 of the
 * prompt is load-bearing — without it, every regeneration silently drops
 * content." This is the only thing that checks that claim, and the failure it
 * guards against is invisible in ordinary use: a regeneration that re-slugs
 * `client_feedback` to `feedback` does not error, it just quietly loses
 * everything the old key held.
 *
 * ── Why this does NOT touch the database ───────────────────────────────────
 * The property under test lives entirely in the prompt. Driving generateSummary
 * directly and feeding its own output back in exercises exactly the additive
 * path finalize-project.ts takes, without needing a linked Supabase project, a
 * seeded user, or the pipeline. Faster, and it fails for one reason only.
 *
 * ── Why the assertions are STRUCTURAL ──────────────────────────────────────
 * The model's prose differs every run. Asserting on wording would flake and
 * would train whoever hits the flake to loosen the test until it checks
 * nothing. What must hold is structural — keys survive, facts survive, quotes
 * are verbatim — and that is what is asserted.
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

const keysOf = (s: { sections: { key: string }[] }) => s.sections.map((x) => x.key);
const textOf = (s: { sections: { content: string }[] }) =>
  s.sections.map((x) => x.content).join("\n").toLowerCase();

test("additive summary survives three regenerations", { skip }, async (t) => {
  // ── 1. First generation from a technical description ─────────────────────
  const first = await generateSummary({
    title: TITLE,
    existing: null,
    newDocuments: [
      { filename: "description", docRole: null, text: DESCRIPTION },
    ],
  });

  assert.ok(first.sections.length > 0, "first generation produced no sections");
  const firstKeys = keysOf(first);
  assert.equal(
    new Set(firstKeys).size,
    firstKeys.length,
    `duplicate keys in first generation: ${firstKeys.join(", ")}`,
  );

  // The anchor hint exists so a thin description does not come back as a
  // single blob keyed `summary`, which every later regeneration then inherits.
  assert.ok(
    firstKeys.length > 1 || firstKeys[0] !== "summary",
    `collapsed to a single 'summary' section: ${firstKeys.join(", ")}`,
  );
  t.diagnostic(`first: ${firstKeys.join(", ")}`);

  // ── 2. A testimonial is added ────────────────────────────────────────────
  const second = await generateSummary({
    title: TITLE,
    existing: first as Summary,
    newDocuments: [
      {
        filename: "northwind-testimonial.pdf",
        docRole: "client testimonial",
        text: TESTIMONIAL,
      },
    ],
  });

  const secondKeys = keysOf(second);
  t.diagnostic(`second: ${secondKeys.join(", ")}`);

  // RULE 1. The whole point.
  for (const key of firstKeys) {
    assert.ok(
      secondKeys.includes(key),
      `key "${key}" was dropped or renamed on regeneration. ` +
        `Prompt rule 1 is not landing. Before: [${firstKeys.join(", ")}] ` +
        `After: [${secondKeys.join(", ")}]`,
    );
  }

  // A testimonial genuinely fits none of the existing sections, so rule 2
  // should produce one. This is the acceptance criterion from PRD §14 T6.
  assert.ok(
    secondKeys.length > firstKeys.length,
    `no new section for the testimonial: [${secondKeys.join(", ")}]`,
  );

  // RULE 6: quotes reproduced VERBATIM. A paraphrased testimonial has no reuse
  // value, which is the entire reason the rule exists.
  const secondText = textOf(second);
  assert.ok(
    secondText.includes("paid for itself in the first quarter") ||
      secondText.includes("before the first coffee"),
    "the testimonial was paraphrased rather than quoted verbatim",
  );

  // Facts from step 1 survive the addition.
  assert.ok(
    secondText.includes("240") || secondText.includes("rotterdam"),
    "facts from the first generation were lost when the testimonial was added",
  );

  // ── 3. A retrospective contradicts a fact ────────────────────────────────
  const third = await generateSummary({
    title: TITLE,
    existing: second as Summary,
    newDocuments: [
      {
        filename: "post-launch-review.docx",
        docRole: "internal retrospective",
        text: RETROSPECTIVE,
      },
    ],
  });

  const thirdKeys = keysOf(third);
  t.diagnostic(`third: ${thirdKeys.join(", ")}`);

  for (const key of secondKeys) {
    assert.ok(
      thirdKeys.includes(key),
      `key "${key}" was dropped or renamed on the second regeneration. ` +
        `Before: [${secondKeys.join(", ")}] After: [${thirdKeys.join(", ")}]`,
    );
  }

  const thirdText = textOf(third);

  // RULE 4: on direct contradiction, prefer the newer content.
  assert.ok(
    thirdText.includes("310"),
    "the corrected driver count (310) did not supersede the original",
  );

  // ...and only the contradicted fact changes. The migration window was
  // explicitly reaffirmed by the retrospective, so losing it would mean the
  // model rewrote rather than merged.
  assert.ok(
    thirdText.includes("weekend") || thirdText.includes("march"),
    "an uncontradicted fact was lost during the correction",
  );

  // The verbatim quote must survive a regeneration that had nothing to do
  // with it — rule 3, "return a section unchanged when the new content adds
  // nothing to it".
  assert.ok(
    thirdText.includes("paid for itself in the first quarter") ||
      thirdText.includes("before the first coffee"),
    "the client quote was lost or paraphrased during a later regeneration",
  );
});
