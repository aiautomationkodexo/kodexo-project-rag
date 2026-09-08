import "server-only";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { serverEnv } from "@/lib/env";
import {
  CaseStudyOutlineSchema,
  MetadataSchema,
  OutcomesSchema,
  SummarySchema,
  type CaseStudyOutline,
  type ExtractedMetadata,
  type ExtractedOutcomes,
  type GeneratedSummary,
} from "./schemas";
import type { Summary } from "@/lib/types";

/**
 * 1536 dims is baked into `vector(1536)` in the schema — changing this model
 * means a full re-embed and a migration. 8191 tokens per input comfortably
 * exceeds our 3200-char chunk.
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Single swap point. PRD §1 specifies gpt-4o-mini and it still works — set
 * OPENAI_CHAT_MODEL=gpt-4o-mini to restore it with no code change.
 */
export const CHAT_MODEL = serverEnv.chatModel ?? "gpt-5-mini";

/** PRD §11. The API caps at 2048 inputs, but see the token note in embedBatch. */
const EMBED_BATCH = 100;
/** Aggregate per-request token ceiling sits well below 100 × 8191 chars. */
const EMBED_BATCH_CHARS = 600_000;

function client() {
  // Constructed per call, never module-scope: on Fluid compute a module-scope
  // client is shared across requests. maxRetries covers 429/5xx backoff.
  return new OpenAI({ apiKey: serverEnv.openaiApiKey, maxRetries: 4 });
}

/**
 * Embeds in batches, preserving input order.
 *
 * CRITICAL: results are reassembled by `item.index`, NOT by array position.
 * The API does not guarantee response ordering, and mismatched embeddings are
 * a silent corruption that only ever surfaces as inexplicably bad search
 * results, months later.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const openai = client();
  const out: number[][] = new Array(texts.length);

  let start = 0;
  while (start < texts.length) {
    let end = start;
    let chars = 0;
    while (
      end < texts.length &&
      end - start < EMBED_BATCH &&
      chars + (texts[end]?.length ?? 0) <= EMBED_BATCH_CHARS
    ) {
      chars += texts[end]?.length ?? 0;
      end += 1;
    }
    // Guarantee forward progress even if a single input exceeds the char budget.
    if (end === start) end = start + 1;

    const slice = texts.slice(start, end);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: slice,
    });

    for (const item of response.data) {
      out[start + item.index] = item.embedding;
    }
    start = end;
  }

  return out;
}

export async function embedQuery(query: string): Promise<number[]> {
  const [embedding] = await embedBatch([query]);
  if (!embedding) throw new Error("Failed to embed query");
  return embedding;
}

// ═══════════════════════════════════════════════════════════════════════════
// Metadata extraction — ADDITIVE (§15.8)
// ═══════════════════════════════════════════════════════════════════════════

const METADATA_SYSTEM = `You extract structured metadata about a software project.

RULES
1. "industry" must be EXACTLY one value from the supplied list, or "Other".
2. "industry_confidence" is 0-1.
3. "tech" lists technologies actually used. No version numbers. Omit generic
   terms like "web app", "database", "API", "cloud".
4. If the material does not support a claim, leave it out rather than guessing.`;

export async function extractMetadata(input: {
  corpus: string;
  industries: string[];
  existingTags: string[];
}): Promise<ExtractedMetadata> {
  const openai = client();

  const completion = await openai.chat.completions.parse({
    model: CHAT_MODEL,
    // No `temperature`: the gpt-5 reasoning family rejects it with a 400 while
    // gpt-4o-mini accepts it. Omitting it is the only setting valid for both,
    // which is what actually keeps CHAT_MODEL swappable.
    messages: [
      { role: "system", content: METADATA_SYSTEM },
      {
        role: "user",
        content: [
          `Available industries: ${input.industries.join(", ")}`,
          `Tags already on this project (context only — never remove these): ${
            input.existingTags.join(", ") || "(none)"
          }`,
          "",
          "--- PROJECT MATERIAL ---",
          input.corpus,
        ].join("\n"),
      },
    ],
    response_format: zodResponseFormat(MetadataSchema, "metadata"),
  });

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Metadata extraction returned no parsed output");
  return parsed;
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary — open sections, additive
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PRD §11, transcribed verbatim.
 *
 * Rule 1 is LOAD-BEARING (§15.11). It does the job a fixed enum would, without
 * constraining what can be captured — without it every regeneration silently
 * re-slugs keys and drops content. Rule 3 is what stops needless rewrites.
 * Rule 6 exists because a paraphrased testimonial has no reuse value.
 */
export const SUMMARY_SYSTEM = `You maintain a structured project summary. Reply with JSON only:
{ "sections": [ { "key": "...", "label": "...", "content": "..." } ] }

RULES
1. Reuse existing section keys EXACTLY as given. Never rename, merge, or re-slug them.
2. Create a new section only when content genuinely fits none of the existing ones.
   Use a lowercase_snake_case key and a short human label.
3. Return a section unchanged when the new content adds nothing to it.
4. Preserve every fact already present. On direct contradiction, prefer the newer
   content — later documents supersede earlier ones.
5. Omit a section only if it would be empty.
6. Reproduce client quotes and testimonials VERBATIM, in quotation marks, with
   attribution when known. Never paraphrase them.
7. Plain prose. No markdown. 2-6 sentences per section.
8. Order sections so general context comes before specifics.`;

/**
 * Appended to SUMMARY_SYSTEM when the project's NDA status does not permit
 * naming the client (see disclosure() in src/lib/projects/disclosure.ts).
 *
 * ── WHY THIS IS CONDITIONAL AND NOT RULE 9 ────────────────────────────────
 * A blanket "never name the client" rule would CONTRADICT rule 6, which
 * mandates reproducing testimonials verbatim "with attribution when known" —
 * and attribution is naming. Rule 6 is load-bearing (a paraphrased
 * testimonial has no reuse value) and is asserted by `npm run test:llm`. Two
 * rules giving opposite instructions about the same string produce
 * unpredictable PARTIAL redaction, which is worse than none because it looks
 * like a guarantee.
 *
 * So the suppression is scoped to the projects that actually require it, and
 * it resolves the conflict in one direction explicitly: quote bodies stay
 * verbatim (rule 6 wins), attribution moves to role rather than name.
 *
 * ── AND IT IS A MITIGATION, NOT A CONTROL ─────────────────────────────────
 * The model still receives the client's name in the corpus, because
 * documents.raw_text genuinely contains it. This asks the model not to repeat
 * it. That is a request, not a boundary. The structural guarantee is that
 * project_client is never read here at all (see finalize-project.ts).
 */
export const CLIENT_ANONYMITY_RULE = `
9. Do NOT name the client organisation, and do not include client contact
   names. Refer to them as "the client".
   Rule 6 still applies to quote BODIES — reproduce them verbatim, even where
   the quoted text names the organisation itself. Change only the attribution:
   give the speaker's role ("the client's Head of Operations"), never a
   personal name.`;

/**
 * Suggested starting keys are a HINT, not a requirement. Without an anchor a
 * thin description comes back as a single blob keyed `summary`, and every later
 * regeneration inherits that shape.
 */
const FIRST_GENERATION_HINT =
  "Suggested starting sections (use only those that fit, add others freely): " +
  "overview, problem, solution, architecture, outcomes";

export async function generateSummary(input: {
  title: string;
  existing: Summary | null;
  /** New material only — NOT the whole corpus re-summarised. */
  newDocuments: { filename: string; docRole: string | null; text: string }[];
  /**
   * False when the project's NDA terms forbid naming the client. Defaults to
   * FALSE — fail closed, matching disclosure()'s own default, so a caller that
   * forgets to pass it gets the anonymised prompt rather than the leaky one.
   */
  mayUseClientName?: boolean;
}): Promise<GeneratedSummary> {
  const openai = client();
  const systemPrompt = input.mayUseClientName
    ? SUMMARY_SYSTEM
    : SUMMARY_SYSTEM + CLIENT_ANONYMITY_RULE;
  const isFirst = !input.existing?.sections?.length;

  const documents = input.newDocuments
    // doc_role is passed through verbatim: it is how the model distinguishes a
    // client testimonial from an internal retro.
    .map(
      (d) =>
        `--- ${d.filename}${d.docRole ? ` (${d.docRole})` : ""} ---\n${d.text}`,
    )
    .join("\n\n");

  const userContent = [
    `Project title: ${input.title}`,
    "",
    isFirst
      ? FIRST_GENERATION_HINT
      : `Existing summary (reuse these keys exactly):\n${JSON.stringify(
          input.existing,
          null,
          2,
        )}`,
    "",
    "--- NEW MATERIAL ---",
    documents,
  ].join("\n");

  const completion = await openai.chat.completions.parse({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: zodResponseFormat(SummarySchema, "summary"),
  });

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Summary generation returned no parsed output");
  return parsed;
}

/**
 * Flattens the section array for display and for the project-level embedding.
 * The UI renders the ARRAY (§15.12); this string is not a substitute for it.
 */
export function renderSummary(summary: Summary): string {
  return (summary.sections ?? [])
    .filter((s) => s.content?.trim())
    .map((s) => `${s.label}\n${s.content.trim()}`)
    .join("\n\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Features delivered and proof points (migration 0017)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── ONE CALL, NOT TWO ─────────────────────────────────────────────────────
 * The corpus is the dominant token cost in this system — finalizeProject
 * concatenates every active document's full raw_text, and there is no
 * truncation anywhere on the chat path. Two calls re-send that whole payload
 * twice, on every finalize AND every manual regenerate, to separate two tasks
 * that share a system prompt anyway ("pull concrete deliverables out of this
 * corpus; do not invent").
 *
 * The cost is failure isolation: a schema failure loses both lists. That is
 * ACCEPTED because the caller degrades gracefully — a failure skips the wipe
 * entirely and the previously-extracted rows survive. One call therefore
 * makes the wipe-and-rebuild one all-or-nothing unit, where two independent
 * calls with independent failures would produce the partial state (features
 * rebuilt, proof points stale) that is genuinely hard to reason about.
 *
 * ── RULE 8 IS BLANKET, AND THAT IS THE DECISION ───────────────────────────
 * Unlike CLIENT_ANONYMITY_RULE, this rule is UNCONDITIONAL rather than gated
 * on disclosure(). There is no rule-6 conflict to resolve here: nothing in
 * this prompt mandates naming anybody, so there is no counter-instruction to
 * produce the unpredictable PARTIAL redaction that conditional scoping exists
 * to avoid. Blanket is both simpler and stricter, and it costs nothing.
 *
 * Consequently extractOutcomes takes NO mayUseClientName parameter. That
 * absence is deliberate and tests/outcomes.test.mts pins it — adding one
 * would reintroduce exactly the contradiction the summariser has to manage.
 *
 * ── ⚠ IT IS STILL A MITIGATION, NOT A CONTROL ─────────────────────────────
 *   The model receives raw_text, which genuinely contains client names, and
 *   evidence_quote is verbatim BY DESIGN — so a leak is possible and nothing
 *   detects it. Migration 0017 states this on the schema itself. Never
 *   describe this rule as a guarantee, in UI copy or anywhere else.
 */
export const OUTCOMES_SYSTEM = `You extract two lists from the material for a software project: the features it delivered, and the proof points that evidence its results.

RULES
1. "features" lists what was actually BUILT and SHIPPED. Each entry has a
   short noun-phrase "name" ("Real-time load assignment") and a "description"
   of one or two sentences of plain prose.
2. Never list a feature the material does not state was delivered. A plan, a
   proposal, a backlog item or a "next phase" is not a delivered feature.
   Omit it.
3. Do not list infrastructure or generic capability as a feature —
   "PostgreSQL database", "REST API", "cloud hosting", "responsive design".
   A feature is something a user of the system can do.
4. "proof_points" lists QUANTIFIED outcomes. Each needs a "claim" stating the
   outcome, and an "evidence_quote" reproduced VERBATIM from the material:
   copy the supporting sentence exactly, character for character. Never
   paraphrase, summarise or reconstruct a quote.
5. Set "metric" to the isolated figure when the claim has one ("11 minutes to
   under 2 minutes", "310 drivers", "40%"). Set it to null when the outcome is
   real but not numeric. NEVER invent a number to fill this field.
6. Set "source_filename" to the filename EXACTLY as it appears in the
   "--- filename ---" header of the block the quote came from. Use null if you
   cannot identify the block.
7. Return an empty array rather than a weak entry. Three real proof points are
   worth more than eight where five are inferred. If the material supports
   none, return [].
8. NEVER name a client, customer, company or brand — not in a feature name, a
   description, a claim, a metric, or an evidence quote. This applies even
   when the material names them repeatedly, and even INSIDE a verbatim quote:
   replace the name in the quote with the role or a generic noun ("the
   client", "the operator", "the depot") and change NOTHING else about the
   quoted wording. Attribute speakers by ROLE ("the client's Operations
   Director"), never by personal name.
9. Plain prose. No markdown, no bullet characters, no headings.
10. Order both lists most significant first.`;

export async function extractOutcomes(input: {
  corpus: string;
  title: string;
}): Promise<ExtractedOutcomes> {
  const openai = client();

  const completion = await openai.chat.completions.parse({
    model: CHAT_MODEL,
    // No `temperature` — see extractMetadata. The gpt-5 family 400s on it.
    messages: [
      { role: "system", content: OUTCOMES_SYSTEM },
      {
        role: "user",
        content: [
          `Project title: ${input.title}`,
          "",
          "--- PROJECT MATERIAL ---",
          input.corpus,
        ].join("\n"),
      },
    ],
    response_format: zodResponseFormat(OutcomesSchema, "outcomes"),
  });

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Outcome extraction returned no parsed output");
  return parsed;
}

// ═══════════════════════════════════════════════════════════════════════════
// Case study outline (migration 0018)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── NEVER INVENT, EVEN THOUGH THAT LEAVES SECTIONS THIN ───────────────────
 * Rule 2 is load-bearing. A model allowed to write plausible filler produces
 * a document that LOOKS finished when the underlying material does not
 * support it, and a fabrication here has a direct path into a client-facing
 * case study. Leaving a section's content empty is the correct output when
 * the corpus says nothing — not a failure to work around.
 *
 * ── EXTERNALLY FACING, SO disclosure() IS NOT OPTIONAL ────────────────────
 * This is the most outward-bound artifact the system produces — a file a
 * human downloads and pastes into a client-facing document. It therefore
 * takes mayUseClientName and follows the CLIENT_ANONYMITY_RULE pattern
 * exactly, including its resolution of the verbatim-quote conflict: the
 * testimonial section mandates verbatim quotes, so a blanket ban would
 * contradict it and produce unpredictable partial redaction. Scoped and
 * explicit, like the summariser.
 *
 * ⚠ STILL A MITIGATION, NOT A CONTROL. The model receives raw_text, which
 *   genuinely contains client names. The structural guarantee remains that
 *   project_client is never read on this path.
 */
const CASE_STUDY_SYSTEM = `You draft the OUTLINE of a case study for a software project, for an internal writer who will finish it.

You are given the project material and a fixed list of sections. Return content for those sections and nothing else.

RULES
1. Use ONLY the section keys supplied. Never invent, rename, merge or reorder
   them. Return every key you were given, even when its content is empty.
2. NEVER INVENT ANYTHING. No plausible-sounding figures, no imagined quotes,
   no inferred client motivations, no "likely" outcomes. If the material does
   not state it, it does not go in "content". A confident fabrication in this
   document ends up in a client-facing case study.
3. "content" is plain prose, 2-5 sentences, in the voice of a finished case
   study. No markdown, no bullet characters, no headings, no meta-commentary
   about the material or about what you were asked to do.
4. Leave "content" as an empty string when the material supports nothing for
   that section. An empty section is a correct answer; filler is not.
5. Reproduce client quotes and testimonials VERBATIM, in quotation marks.
   Never paraphrase a quote. If there are none in the material, leave the
   testimonial content empty.
6. "headline" is one line positioning the project — the sentence a reader sees
   first. Null if the material does not support one; never a slogan you made
   up.
7. Quantified results must carry their figures exactly as the material states
   them. Never round, scale, restate or combine numbers.`;

/**
 * Appended when disclosure() forbids naming the client.
 *
 * Reuses CLIENT_ANONYMITY_RULE's exact resolution rather than restating it:
 * quote bodies stay verbatim, attribution moves to role. Numbered to follow
 * this prompt's own rules, and it names rule 5 (this prompt's verbatim rule)
 * rather than the summariser's rule 6.
 */
const CASE_STUDY_ANONYMITY_RULE = `
8. Do NOT name the client organisation, and do not include client contact
   names, anywhere in this document — not in the headline or the content.
   Refer to them as "the client", and identify them by sector and scale
   instead ("a national logistics operator").
   Rule 5 still applies to quote BODIES — reproduce them verbatim, even where
   the quoted text names the organisation itself. Change only the attribution:
   give the speaker's role ("the client's Head of Operations"), never a
   personal name.`;

export async function generateCaseStudyOutline(input: {
  title: string;
  corpus: string;
  /** Ordered {key, label, brief} — the skeleton. Content only, never shape. */
  sections: readonly { key: string; label: string; brief: string }[];
  /**
   * False when the project's NDA terms forbid naming the client. Defaults to
   * FALSE — fail closed, exactly as generateSummary does, so a caller that
   * forgets it gets the anonymised prompt rather than the leaky one.
   */
  mayUseClientName?: boolean;
}): Promise<CaseStudyOutline> {
  const openai = client();
  const systemPrompt = input.mayUseClientName
    ? CASE_STUDY_SYSTEM
    : CASE_STUDY_SYSTEM + CASE_STUDY_ANONYMITY_RULE;

  const brief = input.sections
    .map((s) => `- ${s.key} (${s.label}): ${s.brief}`)
    .join("\n");

  const completion = await openai.chat.completions.parse({
    model: CHAT_MODEL,
    // No `temperature` — see extractMetadata. The gpt-5 family 400s on it.
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          `Project title: ${input.title}`,
          "",
          "SECTIONS TO FILL (use these keys exactly, return all of them):",
          brief,
          "",
          "--- PROJECT MATERIAL ---",
          input.corpus,
        ].join("\n"),
      },
    ],
    response_format: zodResponseFormat(
      CaseStudyOutlineSchema,
      "case_study_outline",
    ),
  });

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) {
    throw new Error("Case study outline returned no parsed output");
  }
  return parsed;
}
