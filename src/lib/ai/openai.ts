import "server-only";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { serverEnv } from "@/lib/env";
import {
  MetadataSchema,
  SummarySchema,
  type ExtractedMetadata,
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
