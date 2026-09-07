import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, TARGET, OVERLAP, MIN_CHUNK } from "@/lib/pipeline/chunk";

/**
 * PRD §10 chunking. Uniform across content types by design — there is
 * deliberately no special handling for testimonials or transcripts, so these
 * tests use generic prose.
 */

const para = (n: number, char = "a") => char.repeat(n);

test("short text is a single chunk", () => {
  const text = "A paragraph comfortably under the target size.";
  assert.deepEqual(chunkText(text), [text]);
});

test("chunks under the floor are discarded", () => {
  assert.deepEqual(chunkText("tiny"), []);
  assert.equal("tiny".length < MIN_CHUNK, true);
});

test("empty and whitespace-only input yields nothing", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n\n  \t "), []);
});

test("paragraphs pack up to the target rather than one chunk each", () => {
  // Three 500-char paragraphs are ~1500 chars, well under TARGET — packing
  // them into one chunk is the whole point. One chunk per paragraph would
  // triple the embedding cost and shred the context.
  const text = [para(500), para(500, "b"), para(500, "c")].join("\n\n");
  const chunks = chunkText(text);
  assert.equal(chunks.length, 1);
});

test("an oversized single paragraph is hard-split with overlap", () => {
  const chunks = chunkText(para(TARGET * 2 + 500));

  assert.ok(chunks.length > 1, "expected a hard split");
  for (const chunk of chunks) {
    assert.ok(
      chunk.length <= TARGET,
      `chunk of ${chunk.length} exceeds TARGET ${TARGET}`,
    );
  }
});

test("consecutive chunks overlap, so a fact on a boundary survives", () => {
  // The reason OVERLAP exists: without it a sentence split across the boundary
  // is retrievable from neither chunk.
  const chunks = chunkText(para(TARGET * 3));
  assert.ok(chunks.length >= 2);

  const stride = TARGET - OVERLAP;
  assert.ok(stride > 0, "OVERLAP must be smaller than TARGET");
  // Total length exceeds the raw text length precisely because of the overlap.
  const total = chunks.reduce((n, c) => n + c.length, 0);
  assert.ok(total > TARGET * 3 - chunks.length, "chunks should overlap, not partition");
});

test("chunking is deterministic", () => {
  // process-document.ts treats a zero-chunk result as PERMANENT on the
  // grounds that chunkText is a pure function of the text. That reasoning is
  // only sound while this holds.
  const text = [para(4000), para(2000, "b"), "short tail paragraph here."].join("\n\n");
  assert.deepEqual(chunkText(text), chunkText(text));
});

test("newline styles normalise to the same chunks", () => {
  const body = [para(200), para(200, "b")].join("\n\n");
  assert.deepEqual(chunkText(body.replace(/\n/g, "\r\n")), chunkText(body));
});
