/**
 * File classification, shared by the client dropzone and the server route.
 *
 * NOT `server-only` on purpose — the dropzone rejects bad files before any
 * upload happens, and the route re-checks because a client check is an
 * affordance, never a boundary.
 */

/** Mirrors both the bucket's file_size_limit and documents.size_bytes CHECK. */
export const MAX_FILE_BYTES = 52_428_800; // 50 MB
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
  // T7 (Deepgram). Present so the bucket allowlist and this table stay in sync,
  // but gated by T7_EXTENSIONS below until transcription ships.
  ".mp3": ["audio/mpeg"],
  ".wav": ["audio/wav"],
  ".m4a": ["audio/x-m4a", "audio/mp4"],
  ".mp4": ["video/mp4", "audio/mp4"],
  ".mov": ["video/quicktime"],
};

/** Accepted by the bucket, not yet extractable. Rejected with a clear reason. */
export const T7_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".mp4", ".mov"]);

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

  if (T7_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      reason: "Audio and video transcription is not available yet.",
    };
  }

  if (input.size <= 0) return { ok: false, reason: "The file is empty." };
  if (input.size > MAX_FILE_BYTES) {
    const mb = (input.size / 1_048_576).toFixed(1);
    return { ok: false, reason: `${mb} MB exceeds the 50 MB limit.` };
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
