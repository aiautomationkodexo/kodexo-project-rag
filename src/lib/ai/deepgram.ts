import "server-only";

import { z } from "zod";
import { serverEnv } from "@/lib/env";

/**
 * Deepgram pre-recorded transcription (PRD §10, T7).
 *
 * The SIGNED STORAGE URL is POSTed and Deepgram fetches the bytes itself, so
 * neither a 200 MB buffer nor the audio ever passes through this function or
 * through Vercel. That is also why the audio/video branch in extract.ts sits
 * ABOVE download(): reaching download() with a 200 MB video would blow the
 * invocation's memory to produce a buffer nothing reads.
 */

/** PRD §1. Accepts mp4/mov containers directly — there is no ffmpeg step. */
export const TRANSCRIPTION_MODEL = "nova-3";

const ENDPOINT = "https://api.deepgram.com/v1/listen";

/**
 * PRD §10, transcribed verbatim. Neither flag is cosmetic: `diarize` produces
 * the speaker attribution and `paragraphs` produces the blank-line-separated
 * blocks that chunk.ts splits on. Dropping either changes what gets embedded.
 */
const PARAMS = new URLSearchParams({
  model: TRANSCRIPTION_MODEL,
  smart_format: "true",
  diarize: "true",
  paragraphs: "true",
});

/**
 * TIMING INVARIANT, and all three numbers have to move together:
 *
 *   TRANSCRIBE_TIMEOUT_MS (600s)  <  maxDuration (800s)  <  reclaim (900s)
 *
 * The second inequality is what prevents a double dispatch: claim_document
 * (0005_rpc.sql) reclaims a document stuck in 'processing' after 15 minutes,
 * and maxDuration=800 guarantees the first invocation is already dead by then.
 * Raise maxDuration past 900, or lower the reclaim interval, and two workers
 * can transcribe the same document and race delete-then-insert on its chunks.
 *
 * The first inequality is what makes a hung call FAIL VISIBLY. Vercel's kill at
 * maxDuration is uncatchable: no catch runs, so no status write, no error
 * string, no attempt bookkeeping — the document simply sits in 'processing'
 * for 15 minutes and then gets reclaimed with error = NULL. An application
 * timeout converts that into an ordinary, message-carrying, promptly-retried
 * failure. The ~200s of headroom is for embedBatch and the finalize tail, which
 * run inside the SAME invocation budget.
 */
export const TRANSCRIBE_TIMEOUT_MS = 600_000;

/**
 * A Deepgram failure tagged with whether re-running could ever succeed.
 *
 * NOT PermanentExtractionError: that is pipeline vocabulary and extract.ts
 * imports this module, so throwing it here would close an import cycle
 * (extract → deepgram → extract). extract.ts translates at the single call
 * site, which keeps this file a plain API client in the shape of openai.ts.
 */
export class DeepgramError extends Error {
  readonly permanent: boolean;
  readonly status: number | null;
  constructor(message: string, o: { permanent: boolean; status?: number | null }) {
    super(message);
    this.name = "DeepgramError";
    this.permanent = o.permanent;
    this.status = o.status ?? null;
  }
}

/**
 * Only the path we actually read. Zod strips unknown keys by default, which is
 * the point: the real response also carries word-level timings, metadata and
 * request ids, and modelling none of it means Deepgram ADDING a field cannot
 * break us. Everything below `alternatives` is optional because a clip too
 * short to segment comes back with no `paragraphs` block at all.
 *
 * Deliberately NOT in ai/schemas.ts. That file's banner mandates the OpenAI
 * Structured Outputs contract — "EVERY property must be required, express
 * optionality as .nullable(), never .optional()" — and a tolerant wire schema
 * is the exact opposite. Putting this there would sit it under a rule it
 * breaks on every line.
 */
const ResponseSchema = z.object({
  results: z.object({
    channels: z
      .array(
        z.object({
          alternatives: z
            .array(
              z.object({
                transcript: z.string().default(""),
                paragraphs: z
                  .object({
                    paragraphs: z.array(
                      z.object({
                        // Absent when diarization finds a single speaker.
                        speaker: z.number().optional(),
                        sentences: z.array(z.object({ text: z.string() })),
                      }),
                    ),
                  })
                  .optional(),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  }),
});
type DeepgramResponse = z.infer<typeof ResponseSchema>;

/** Deepgram's error envelope. The shape varies by failure class. */
const ErrorSchema = z.object({
  err_code: z.string().optional(),
  err_msg: z.string().optional(),
  error: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * Transcribes the media at `signedUrl` and returns plain text.
 *
 * There is deliberately NO in-module retry loop, unlike openai.ts's
 * `maxRetries: 4`. An embedding retry costs milliseconds; a transcription
 * retry costs minutes, against a hard 800s ceiling — two attempts in one
 * invocation could exceed it and get killed uncatchably. The pipeline's own
 * three-attempt retry runs at the 5-minute cron cadence and mints a FRESH
 * signed URL each time, which is the right granularity for a minutes-scale job.
 */
export async function transcribe(signedUrl: string): Promise<string> {
  // Read BEFORE the try. required() throws on a missing variable, and that
  // throw caught below and re-wrapped as a transient DeepgramError would
  // disguise a config error as a network blip. Same hoist, same reason, as
  // dispatch.ts and the cron sweep.
  const apiKey = serverEnv.deepgramApiKey;

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?${PARAMS}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: signedUrl }),
      // AbortSignal.timeout, not controller + setTimeout: it clears its own
      // timer, so a fast response cannot leave a pending timer holding the
      // invocation alive past its work.
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
  } catch (error) {
    // ALWAYS transient. Our own abort, DNS, TLS and socket resets all say
    // nothing whatsoever about the recording.
    throw new DeepgramError(
      `Could not reach the transcription service: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { permanent: false },
    );
  }

  if (!response.ok) throw await failure(response);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DeepgramError("Transcription returned a malformed response.", {
      permanent: false,
    });
  }

  const parsed = ResponseSchema.safeParse(payload);
  if (!parsed.success) {
    // A 200 whose shape we do not recognise is a Deepgram-side change or a
    // truncated body — not a property of the file. Retrying means a schema
    // drift shows up as a burst of identical retry failures in the logs,
    // rather than as a pile of permanently-failed good recordings.
    throw new DeepgramError("Transcription returned an unrecognised response.", {
      permanent: false,
    });
  }

  const text = render(parsed.data);
  if (!text) {
    // The audio equivalent of a scanned PDF (see MIN_PDF_TEXT in extract.ts).
    // Deepgram decoded the file and found no speech; three more passes over
    // the same silence cannot differ.
    throw new DeepgramError("No speech was detected in this recording.", {
      permanent: true,
    });
  }

  return text;
}

/**
 * One paragraph per block, `Speaker N:` prefixed when diarization landed.
 *
 * Exported for tests — the speaker numbering and the transcript fallback are
 * both easy to regress and neither is visible without reading a transcript.
 *
 * The prefix repeats on EVERY paragraph rather than only on a speaker change:
 * chunk.ts splits on blank lines, so a block that inherits its attribution from
 * the block above loses it the moment the two land in different chunks — and a
 * retrieved snippet is read entirely on its own.
 */
export function render(payload: DeepgramResponse): string {
  // channels[0] only. `multichannel` is not requested (it is mutually
  // exclusive with diarize), so there is exactly one channel by construction.
  const alternative = payload.results.channels[0]?.alternatives[0];
  if (!alternative) return "";

  const blocks = (alternative.paragraphs?.paragraphs ?? [])
    .map((p) => {
      const text = p.sentences
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join(" ");
      if (!text) return "";
      // Deepgram numbers speakers from 0. Rendered 1-based: this string becomes
      // documents.raw_text and is shown verbatim in search snippets, where
      // "Speaker 0:" reads as an off-by-one bug rather than as a transcript.
      return p.speaker === undefined ? text : `Speaker ${p.speaker + 1}: ${text}`;
    })
    .filter(Boolean);

  // Fall back to the flat transcript: `paragraphs` is absent when a clip is too
  // short to segment, and dropping the text would fail a perfectly good
  // twenty-second voice note as "no speech detected".
  return (blocks.length ? blocks.join("\n\n") : alternative.transcript).trim();
}

/**
 * PERMANENT vs TRANSIENT.
 *
 * The axis is NOT "could this request ever succeed". It is "IS THE FILE THE
 * PROBLEM" — which is what PermanentExtractionError's own docblock says. A
 * permanent verdict writes a message onto the USER's document, maxes its
 * attempts, and is terminal: nothing re-queues a `failed` document, because
 * stuck_documents filters on `attempts < 3` and there is no reprocess UI.
 *
 * Exported for tests: this table is the whole of T7's failure behaviour and it
 * cannot be exercised without a live Deepgram account otherwise.
 */
export function isPermanent(status: number, code: string, detail: string): boolean {
  // Past Deepgram's own ceiling. Near-unreachable under our 200 MB cap, but no
  // retry shrinks a file.
  if (status === 413) return true;

  if (status === 400) {
    // THE ONE TRANSIENT 400. Deepgram returns 400 when it could not FETCH the
    // url we handed it — an expired signed URL, a Storage blip, a 5xx from the
    // object endpoint. The file is fine and the next attempt mints a fresh URL,
    // so reading this as permanent fails a good recording forever.
    if (code === "REMOTE_CONTENT_ERROR") return false;
    if (/remote|could not fetch|fetch the url|download/i.test(detail)) return false;

    // Everything else 400 is undecodable media or a request this code built
    // wrong. Both are perfectly stable across retries.
    return true;
  }

  // 401 / 402 / 403 / 429 / 5xx and anything unrecognised: TRANSIENT.
  //
  // The 401 case is the debatable one, and it is deliberate. A wrong key is
  // permanent for this deployment and the file is fine. Classifying it
  // permanent would (a) contradict the MISSING-key path, which is already
  // transient because required() throws a plain Error, so two near-identical
  // operator mistakes would produce opposite document states; and (b) pin
  // "this recording could not be transcribed" on a file that was never the
  // problem. The cost is bounded — during a key outage audio holds its project
  // in 'processing' for ~45 minutes instead of failing fast — and a key fixed
  // inside that window self-heals. extract.ts logs 401/402/403 distinctly so
  // the logs name the real cause, since the document message will not.
  return false;
}

async function failure(response: Response): Promise<DeepgramError> {
  const raw = await response.text().catch(() => "");
  let code = "";
  let detail = "";

  try {
    const body = ErrorSchema.safeParse(JSON.parse(raw));
    if (body.success) {
      code = body.data.err_code ?? "";
      detail = body.data.err_msg ?? body.data.error ?? body.data.reason ?? "";
    }
  } catch {
    detail = raw.slice(0, 300);
  }

  const permanent = isPermanent(response.status, code, detail);

  return new DeepgramError(
    permanent
      ? `This recording could not be transcribed: ${
          detail || code || "unsupported or corrupt media"
        }.`
      : `Transcription failed (${response.status}${code ? ` ${code}` : ""})${
          detail ? `: ${detail}` : ""
        }.`,
    { permanent, status: response.status },
  );
}
