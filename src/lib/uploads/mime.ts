/**
 * File classification, shared by the client dropzone and the server route.
 *
 * NOT `server-only` on purpose — the dropzone rejects bad files before any
 * upload happens, and the route re-checks because a client check is an
 * affordance, never a boundary.
 */

/**
 * Documents only. Every one of these formats is DOWNLOADED into the function
 * and parsed in memory, which is what bounds it.
 */
export const MAX_FILE_BYTES = 52_428_800; // 50 MB

/**
 * Audio and video only (T7). A 10-minute 1080p MP4 is routinely 80-150 MB and
 * there is no user-facing way to shrink one, so 50 MB would have made T7's own
 * acceptance criterion unreachable. Raising it is safe precisely because this
 * path never buffers: Deepgram is handed a signed URL and fetches the bytes
 * itself, so the 50 MB memory argument does not apply.
 *
 * THIS FILE IS THE ONLY PLACE THE PER-TYPE RULE EXISTS. The bucket's
 * file_size_limit is a single scalar and cannot express it, and the
 * documents.size_bytes CHECK is a flat 200 MB bound (migration 0010) — both of
 * those fire only AFTER the bytes have moved. classifyFile runs first, on both
 * sides of the upload, so the distinction has to live here.
 */
export const MAX_MEDIA_BYTES = 209_715_200; // 200 MB

export const MAX_FILES_PER_PROJECT = 20;

/**
 * Extension → permitted declared MIME types. The FIRST entry is canonical and
 * is what we send to Storage; the browser's `File.type` is never trusted.
 *
 * DOCX and PPTX are both ZIP archives with magic bytes `PK\x03\x04`, so the
 * bytes cannot distinguish them. PRD §10's answer is to validate the extension
 * AND the declared MIME and let the parser fail loudly — which is what
 * `extract.ts` does.
 */
export const EXTENSION_MIMES: Record<string, readonly string[]> = {
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain"],
  ".pdf": ["application/pdf"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ".pptx": [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  // Transcribed via Deepgram (T7) — see src/lib/ai/deepgram.ts.
  ".mp3": ["audio/mpeg"],
  ".wav": ["audio/wav"],
  ".m4a": ["audio/x-m4a", "audio/mp4"],
  ".mp4": ["video/mp4", "audio/mp4"],
  ".mov": ["video/quicktime"],
};

/** Transcribed rather than parsed, and carrying the larger size cap (T7). */
export const MEDIA_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".mp4", ".mov"]);

export function maxBytesFor(extension: string): number {
  return MEDIA_EXTENSIONS.has(extension) ? MAX_MEDIA_BYTES : MAX_FILE_BYTES;
}

/** Explicitly refused, with a message that says what to do instead. */
export const REJECTED_EXTENSIONS: Record<string, string> = {
  ".zip": "Archives are not accepted — upload the documents individually.",
  ".rar": "Archives are not accepted — upload the documents individually.",
  ".7z": "Archives are not accepted — upload the documents individually.",
  ".tar": "Archives are not accepted — upload the documents individually.",
  ".gz": "Archives are not accepted — upload the documents individually.",
  ".tgz": "Archives are not accepted — upload the documents individually.",
  ".doc": "Legacy Word files are not supported. Save as .docx and upload again.",
  ".ppt": "Legacy PowerPoint files are not supported. Save as .pptx and upload again.",
  ".xls": "Spreadsheets are not supported.",
  ".xlsx": "Spreadsheets are not supported.",
  ".pages": "Apple Pages files are not supported. Export as .pdf or .docx.",
  ".key": "Keynote files are not supported. Export as .pdf or .pptx.",
  ".numbers": "Spreadsheets are not supported.",
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}

export type Classification =
  | { ok: true; canonicalMime: string; extension: string }
  | { ok: false; reason: string };

export function classifyFile(input: {
  filename: string;
  declaredMime: string;
  size: number;
}): Classification {
  const ext = extensionOf(input.filename);

  if (!ext) return { ok: false, reason: "The file has no extension." };

  const rejected = REJECTED_EXTENSIONS[ext];
  if (rejected) return { ok: false, reason: rejected };

  const permitted = EXTENSION_MIMES[ext];
  if (!permitted) {
    return { ok: false, reason: `${ext} files are not supported.` };
  }

  if (input.size <= 0) return { ok: false, reason: "The file is empty." };

  const limit = maxBytesFor(ext);
  if (input.size > limit) {
    const mb = (input.size / 1_048_576).toFixed(1);
    // Names the applicable limit, not a constant: told "exceeds the 50 MB
    // limit" for a 120 MB video, a user has no way to learn that video is
    // allowed 200 MB and that their file is the wrong KIND of too big.
    return {
      ok: false,
      reason: `${mb} MB exceeds the ${Math.round(limit / 1_048_576)} MB limit for ${ext} files.`,
    };
  }

  /*
   * Browsers frequently report "" for .md and .txt (and application/octet-stream
   * for anything they don't recognise), so those are accepted and the extension
   * decides. Anything else must actually be in the permitted list — that is
   * PRD §10's "validate extension AND declared MIME".
   */
  const declared = input.declaredMime.trim().toLowerCase();
  const declaredOk =
    declared === "" ||
    declared === "application/octet-stream" ||
    permitted.includes(declared);

  if (!declaredOk) {
    return {
      ok: false,
      reason: `The file says it is ${declared}, which does not match a ${ext} file.`,
    };
  }

  return { ok: true, canonicalMime: permitted[0]!, extension: ext };
}

/** Control characters and other bytes Storage will not accept in an object key. */
const UNSAFE_KEY_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

/**
 * Storage restricts the characters allowed in an object key, so a user's
 * filename cannot be used raw. The DISPLAY name is kept intact on
 * `documents.filename`; only the storage key is sanitised.
 */
export function sanitizeStorageFilename(name: string): string {
  const ext = extensionOf(name);
  const stem = (ext ? name.slice(0, -ext.length) : name)
    .normalize("NFKD")
    .replace(UNSAFE_KEY_CHARS, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 120);
  return stem ? `${stem}${ext}` : `file${ext || ".bin"}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
