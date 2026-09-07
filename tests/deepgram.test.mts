import { test } from "node:test";
import assert from "node:assert/strict";
import { render, isPermanent } from "@/lib/ai/deepgram";

/**
 * T7's failure behaviour and transcript shaping.
 *
 * Both functions are pure and both are otherwise unreachable without a live
 * Deepgram account — which is exactly why they are worth pinning: the
 * classification table decides whether a user's recording is failed forever or
 * retried, and there is no way to observe a mistake in it except by uploading a
 * broken file to production.
 */

function payload(
  paragraphs: { speaker?: number; sentences: { text: string }[] }[] | undefined,
  transcript = "",
) {
  return {
    results: {
      channels: [
        {
          alternatives: [
            { transcript, ...(paragraphs ? { paragraphs: { paragraphs } } : {}) },
          ],
        },
      ],
    },
  } as Parameters<typeof render>[0];
}

test("speaker labels are 1-based, not Deepgram's 0-based", () => {
  // "Speaker 0:" reaches the user verbatim in a search snippet, where it reads
  // as an off-by-one bug rather than as a transcript.
  const text = render(
    payload([
      { speaker: 0, sentences: [{ text: "We shipped in March." }] },
      { speaker: 1, sentences: [{ text: "Ahead of schedule." }] },
    ]),
  );

  assert.match(text, /^Speaker 1: We shipped in March\./);
  assert.match(text, /Speaker 2: Ahead of schedule\./);
});

test("every paragraph carries its own speaker prefix", () => {
  // chunk.ts splits on blank lines, so a block that inherits attribution from
  // the block above loses it the moment the two land in different chunks.
  const text = render(
    payload([
      { speaker: 0, sentences: [{ text: "First." }] },
      { speaker: 0, sentences: [{ text: "Second." }] },
    ]),
  );

  assert.equal(text.split("\n\n").length, 2);
  for (const block of text.split("\n\n")) {
    assert.match(block, /^Speaker 1: /);
  }
});

test("paragraphs are separated by a blank line so chunk.ts can split them", () => {
  const text = render(
    payload([
      { speaker: 0, sentences: [{ text: "One." }] },
      { speaker: 1, sentences: [{ text: "Two." }] },
    ]),
  );
  assert.ok(text.includes("\n\n"));
});

test("sentences within a paragraph join with a space", () => {
  const text = render(
    payload([{ speaker: 0, sentences: [{ text: "One." }, { text: "Two." }] }]),
  );
  assert.equal(text, "Speaker 1: One. Two.");
});

test("undiarized paragraphs get no prefix at all", () => {
  const text = render(payload([{ sentences: [{ text: "Just the words." }] }]));
  assert.equal(text, "Just the words.");
});

test("a clip too short to segment falls back to the flat transcript", () => {
  // Deepgram omits `paragraphs` entirely for very short audio. Dropping the
  // text here would fail a perfectly good twenty-second voice note as
  // "no speech detected".
  assert.equal(render(payload(undefined, "A quick note.")), "A quick note.");
  assert.equal(render(payload([], "A quick note.")), "A quick note.");
});

test("genuinely empty audio renders empty, which the caller treats as permanent", () => {
  assert.equal(render(payload(undefined, "")), "");
  assert.equal(render(payload([{ sentences: [{ text: "   " }] }], "")), "");
});

test("a 400 that means unfetchable URL is TRANSIENT", () => {
  // Deepgram returns 400 when IT could not fetch the signed URL we handed over
  // — an expired link or a Storage blip. The file is fine and the next attempt
  // mints a fresh URL, so reading this as permanent fails a good recording
  // forever. This is the single most consequential row in the table.
  assert.equal(isPermanent(400, "REMOTE_CONTENT_ERROR", ""), false);
  assert.equal(isPermanent(400, "", "Could not fetch the url provided"), false);
  assert.equal(isPermanent(400, "", "failed to download remote content"), false);
});

test("any other 400 is PERMANENT", () => {
  assert.equal(isPermanent(400, "", "corrupt or unsupported media"), true);
  assert.equal(isPermanent(400, "Bad Request", ""), true);
});

test("auth and billing failures are TRANSIENT, not the file's fault", () => {
  // A missing DEEPGRAM_API_KEY is already transient (required() throws a plain
  // Error). A WRONG key must behave the same, or two near-identical operator
  // mistakes produce opposite document states — and the user is told their
  // recording is broken when it is not.
  for (const status of [401, 402, 403]) {
    assert.equal(isPermanent(status, "", ""), false, `status ${status}`);
  }
});

test("rate limits and server errors are TRANSIENT", () => {
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(isPermanent(status, "", ""), false, `status ${status}`);
  }
});

test("413 is PERMANENT — no retry shrinks a file", () => {
  assert.equal(isPermanent(413, "", ""), true);
});

test("an unrecognised status defaults to TRANSIENT", () => {
  // Failing open toward retry is the safe default: the worst case is three
  // wasted attempts, versus permanently rejecting a file that was fine.
  assert.equal(isPermanent(418, "", ""), false);
});
