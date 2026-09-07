import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFile,
  sanitizeStorageFilename,
  maxBytesFor,
  MAX_FILE_BYTES,
  MAX_MEDIA_BYTES,
  type Classification,
} from "@/lib/uploads/mime";

function ok(r: Classification): Extract<Classification, { ok: true }> {
  assert.equal(r.ok, true, `expected accept, got: ${r.ok ? "" : r.reason}`);
  return r as Extract<Classification, { ok: true }>;
}

function rejected(r: Classification): Extract<Classification, { ok: false }> {
  assert.equal(r.ok, false, "expected reject");
  return r as Extract<Classification, { ok: false }>;
}

test("documents are capped at 50 MB and media at 200 MB", () => {
  assert.equal(maxBytesFor(".pdf"), MAX_FILE_BYTES);
  assert.equal(maxBytesFor(".docx"), MAX_FILE_BYTES);
  assert.equal(maxBytesFor(".mp4"), MAX_MEDIA_BYTES);
  assert.equal(maxBytesFor(".mp3"), MAX_MEDIA_BYTES);

  // The boundary in both directions. A 60 MB PDF slipping through is the
  // regression the per-type cap could plausibly introduce.
  rejected(
    classifyFile({ filename: "big.pdf", declaredMime: "application/pdf", size: 60_000_000 }),
  );
  ok(classifyFile({ filename: "talk.mp4", declaredMime: "video/mp4", size: 60_000_000 }));
  rejected(
    classifyFile({ filename: "huge.mp4", declaredMime: "video/mp4", size: 250_000_000 }),
  );
});

test("the size message names the limit that actually applied", () => {
  // Told "exceeds the 50 MB limit" for a video, a user cannot learn that video
  // is allowed 200 MB and that theirs is the wrong KIND of too big.
  const r = rejected(
    classifyFile({ filename: "big.pdf", declaredMime: "application/pdf", size: 60_000_000 }),
  );
  assert.match(r.reason, /50 MB limit for \.pdf/);

  const m = rejected(
    classifyFile({ filename: "huge.mov", declaredMime: "video/quicktime", size: 250_000_000 }),
  );
  assert.match(m.reason, /200 MB limit for \.mov/);
});

test("audio and video are accepted now that T7 has shipped", () => {
  // These were gated behind T7_EXTENSIONS with "not available yet". If that
  // gate ever comes back, every recording is rejected at the dropzone and the
  // Deepgram path becomes unreachable.
  const media: [string, string][] = [
    ["voice.mp3", "audio/mpeg"],
    ["call.wav", "audio/wav"],
    ["memo.m4a", "audio/x-m4a"],
    ["demo.mp4", "video/mp4"],
    ["screen.mov", "video/quicktime"],
  ];
  for (const [filename, declaredMime] of media) {
    ok(classifyFile({ filename, declaredMime, size: 1_000_000 }));
  }
});

test("browsers reporting no MIME are trusted to the extension", () => {
  // Browsers report "" for .md and .txt, and application/octet-stream for
  // anything they do not recognise. Rejecting those makes markdown
  // un-uploadable.
  assert.equal(
    ok(classifyFile({ filename: "notes.md", declaredMime: "", size: 400 })).canonicalMime,
    "text/markdown",
  );
  ok(
    classifyFile({
      filename: "notes.txt",
      declaredMime: "application/octet-stream",
      size: 400,
    }),
  );
});

test("a declared MIME that contradicts the extension is refused", () => {
  const r = rejected(
    classifyFile({ filename: "resume.pdf", declaredMime: "image/png", size: 400 }),
  );
  assert.match(r.reason, /image\/png/);
});

test("archives and legacy Office formats are refused with a next step", () => {
  for (const filename of ["bundle.zip", "old.doc", "deck.ppt", "sheet.xlsx"]) {
    const r = rejected(classifyFile({ filename, declaredMime: "", size: 400 }));
    assert.ok(r.reason.length > 0, filename);
  }
  // The message has to say what to do instead, not merely "no".
  assert.match(
    rejected(classifyFile({ filename: "old.doc", declaredMime: "", size: 400 })).reason,
    /\.docx/,
  );
});

test("empty and extensionless files are refused", () => {
  rejected(classifyFile({ filename: "empty.pdf", declaredMime: "application/pdf", size: 0 }));
  rejected(classifyFile({ filename: "README", declaredMime: "", size: 10 }));
});

test("sanitizeStorageFilename produces a safe key and keeps the extension", () => {
  // Trailing separators survive — only LEADING [._-] are stripped. Harmless,
  // and asserted so the shape is pinned rather than assumed.
  assert.equal(sanitizeStorageFilename("Q3 report (final).pdf"), "Q3_report_final_.pdf");
  // Path traversal is flattened rather than preserved.
  assert.ok(!sanitizeStorageFilename("../../etc/passwd.txt").includes(".."));
  // Control characters are what Storage actually rejects on an object key.
  assert.equal(sanitizeStorageFilename("badname.txt"), "badname.txt");
  // A name that sanitises away entirely must still yield a usable key.
  assert.equal(sanitizeStorageFilename("///.pdf"), "file.pdf");
});
