import "server-only";

import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DeepgramError,
  TRANSCRIBE_TIMEOUT_MS,
  transcribe,
} from "@/lib/ai/deepgram";

/**
 * Text extraction by MIME type (PRD §10).
 *
 * Extraction is CONTENT-AGNOSTIC. Every format lands as plain text and is
 * chunked, embedded and ranked identically — a client's words in a testimonial
 * PDF must rank the same way as a paragraph in a design doc (PRD §6). Do not
 * add per-format special-casing downstream of this file.
 */

export const BUCKET = "project-files";

/**
 * A failure that RE-RUNNING CANNOT FIX: the file is not what it claims to be,
 * has no text layer, or is a format we do not support.
 *
 * The pipeline marks these `failed` immediately instead of returning them to
 * `queued`. Retrying a malformed file three times over three cron cycles
 * cannot succeed, and it keeps the whole project in `processing` for ~15
 * minutes while it fails. Transient failures (network, OpenAI 429) still take
 * the normal retry path.
 */
export class PermanentExtractionError extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = "PermanentExtractionError";
  }
}

export function isPermanentExtractionError(e: unknown): boolean {
  return e instanceof PermanentExtractionError;
}

/** Below this a PDF almost certainly has no text layer. */
const MIN_PDF_TEXT = 100;

export type ExtractableDocument = {
  filename: string;
  mime: string;
  storage_key: string | null;
};

export async function extractText(doc: ExtractableDocument): Promise<string> {
  if (!doc.storage_key) {
    throw new PermanentExtractionError("The document has no stored file to extract.");
  }

  const mime = doc.mime.toLowerCase();

  // Audio and video are handled WITHOUT downloading — Deepgram is handed a
  // signed URL and fetches the bytes itself (PRD §10). This branch sits ABOVE
  // download() on purpose: media is capped at 200 MB, and buffering that here
  // would blow the invocation's memory to build something nothing reads.
  if (mime.startsWith("audio/") || mime.startsWith("video/")) {
    return transcribeStored(doc.storage_key);
  }

  const buffer = await download(doc.storage_key);

  switch (true) {
    case mime.startsWith("text/"):
      return buffer.toString("utf-8");

    case mime === "application/pdf":
      return extractPdf(buffer);

    case mime.includes("wordprocessingml"):
      return extractDocx(buffer);

    case mime.includes("presentationml"):
      return extractPptx(buffer);

    default:
      throw new PermanentExtractionError(`Unsupported type: ${doc.mime}`);
  }
}

/**
 * Deepgram FETCHES the object itself, so this URL must outlive the entire
 * transcription, not merely the POST that hands it over.
 *
 * DERIVED from the timeout rather than written as a literal, so the invariant
 * "the URL outlives the call" cannot be broken by editing one number. If the
 * URL expires mid-transcription Deepgram reports it as a 400 — one string match
 * away from being classified PERMANENT and failing a perfectly good recording.
 *
 * 3x gives headroom for clock skew against Storage's validator and for Deepgram
 * retrying its own fetch, while keeping the life of what is, after all, a
 * bearer credential for the raw file short. Currently 1800s against a 600s
 * timeout.
 */
const SIGNED_URL_TTL_SECONDS = Math.ceil((TRANSCRIBE_TIMEOUT_MS / 1000) * 3);

/**
 * The FIRST createSignedUrl in this codebase. /api/upload-url mints
 * createSignedUploadUrl, which is a different thing — a one-shot WRITE grant.
 * This is a time-boxed READ grant, and `data.signedUrl` is absolute (it carries
 * the project's storage origin), which is what makes it usable by a third party.
 */
async function signedUrl(storageKey: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);

  // Plain Error, i.e. TRANSIENT — deliberately symmetric with download() below,
  // which also treats a missing object as retryable rather than as a verdict on
  // the file. Do not diverge the two without changing both.
  if (error || !data?.signedUrl) {
    throw new Error(
      `Could not sign the stored file: ${error?.message ?? "not found"}`,
    );
  }
  return data.signedUrl;
}

/**
 * THE SINGLE TRANSLATION POINT between Deepgram's wire taxonomy and the
 * pipeline's. Keeping the mapping here is what lets ai/deepgram.ts stay free of
 * a pipeline import — this file already imports it, and the pair would be a
 * cycle.
 *
 * The URL is minted inside the retried unit, not cached on the row, so every
 * pipeline attempt gets a fresh one. That is what makes an expired-URL failure
 * self-healing rather than sticky.
 */
async function transcribeStored(storageKey: string): Promise<string> {
  const url = await signedUrl(storageKey);
  try {
    return await transcribe(url);
  } catch (error) {
    if (error instanceof DeepgramError) {
      // An auth/billing failure is classified TRANSIENT (see isPermanent), so
      // the document message will blame the transcription service generically.
      // Name the real cause here or a bad DEEPGRAM_API_KEY looks like a
      // Deepgram outage for as long as it takes someone to read the logs.
      if (error.status === 401 || error.status === 402 || error.status === 403) {
        console.error(
          `[deepgram] ${error.status} — check DEEPGRAM_API_KEY and the account's plan/credit. ` +
            `Documents will retry and then fail; the file is not the problem.`,
        );
      }
      if (error.permanent) throw new PermanentExtractionError(error.message);
    }
    throw error;
  }
}

async function download(storageKey: string): Promise<Buffer> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(storageKey);
  if (error || !data) {
    throw new Error(`Could not read the stored file: ${error?.message ?? "not found"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * `unpdf`, not `pdf-parse`. The PRD pins pdf-parse@^1.1.1, but that range now
 * resolves to 1.1.4, which vendors two full copies of 2018-era pdf.js (28 MB),
 * and v2 takes a hard dependency on the native `@napi-rs/canvas`. unpdf has
 * zero runtime dependencies and bundles a serverless-targeted pdf.js build.
 */
async function extractPdf(buffer: Buffer): Promise<string> {
  const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await pdfText(pdf, { mergePages: true });

  const merged = Array.isArray(text) ? text.join("\n\n") : text;
  const trimmed = merged.trim();

  // PRD §10: no OCR, by design. A scanned PDF is a scan, and silently indexing
  // an empty string would make the project look processed while being invisible
  // to search.
  if (trimmed.length < MIN_PDF_TEXT) {
    throw new PermanentExtractionError(
      "No text layer — scanned PDFs are not supported",
    );
  }
  return trimmed;
}

async function extractDocx(buffer: Buffer): Promise<string> {
  // Default import only: mammoth is CJS with no exports map, and named imports
  // break under some bundler configurations.
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer });
  return value.trim();
}

/**
 * PPTX, done by hand (PRD §10). No maintained pure-JS extractor produces the
 * shape this needs: slides in order, with speaker notes attributed separately.
 *
 * `fflate` rather than the PRD's `jszip` — 8 KB, zero dependencies, actively
 * maintained (jszip's last release was 2022), and `unzipSync` takes a filter so
 * the media that makes up most of a real deck is never inflated.
 */
function extractPptx(buffer: Buffer): string {
  const wanted = /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/;

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer), {
      filter: (file) => wanted.test(file.name),
    });
  } catch {
    // DOCX and PPTX share `PK\x03\x04`, so a mislabelled file reaches here.
    throw new PermanentExtractionError(
      "The file is not a readable .pptx presentation.",
    );
  }

  const slides = numericallySorted(files, "ppt/slides/slide");
  const notes = numericallySorted(files, "ppt/notesSlides/notesSlide");

  if (slides.length === 0) {
    throw new PermanentExtractionError("The presentation contains no slides.");
  }

  const parser = new XMLParser({
    ignoreAttributes: true,
    // PPTX splits a single word across runs; trimming would weld words together.
    trimValues: false,
    // Keep "2024" a string rather than coercing it to a number.
    parseTagValue: false,
    alwaysCreateTextNode: true,
    // A slide with exactly one <a:t> would otherwise yield a scalar, not an
    // array, and every consumer would need a shape check.
    isArray: (name) => name === "a:t",
  });

  const blocks: string[] = [];

  slides.forEach((xml, i) => {
    const body = textNodes(parser.parse(xml)).join("\n").trim();
    // Notes are matched positionally. notesSlideN does not reliably correspond
    // to slideN (the authoritative mapping lives in the .rels), but for a text
    // corpus attribution to the right neighbourhood is enough, and mismatched
    // notes are far better than dropped ones.
    const note = notes[i] ? textNodes(parser.parse(notes[i]!)).join("\n").trim() : "";

    const parts = [body];
    // Speaker notes routinely carry the real narrative that the slide only
    // gestures at, so they are kept and labelled rather than discarded.
    if (note) parts.push(`Notes: ${note}`);

    const slide = parts.filter(Boolean).join("\n");
    if (slide) blocks.push(slide);
  });

  const text = blocks.join("\n\n").trim();
  if (!text) throw new PermanentExtractionError(
    "No text could be read from the presentation.",
  );
  return text;
}

/**
 * Sorts `slide1, slide2, … slide10` NUMERICALLY.
 *
 * Lexicographic order gives slide1, slide10, slide11, slide2 — which scrambles
 * the deck without ever throwing. The text is all present, so it passes a
 * glance in QA and only shows up later as incoherent summaries.
 */
function numericallySorted(
  files: Record<string, Uint8Array>,
  prefix: string,
): string[] {
  return Object.keys(files)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, n: Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0) }))
    .sort((a, b) => a.n - b.n)
    .map(({ name }) => strFromU8(files[name]!));
}

/** Walks the parsed tree collecting every <a:t> text run, in document order. */
function textNodes(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== "object") return out;

  if (Array.isArray(node)) {
    for (const item of node) textNodes(item, out);
    return out;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "a:t") {
      for (const run of Array.isArray(value) ? value : [value]) {
        const text =
          typeof run === "string"
            ? run
            : typeof (run as { "#text"?: unknown })?.["#text"] === "string"
              ? ((run as { "#text": string })["#text"])
              : "";
        if (text) out.push(text);
      }
    } else {
      textNodes(value, out);
    }
  }
  return out;
}
