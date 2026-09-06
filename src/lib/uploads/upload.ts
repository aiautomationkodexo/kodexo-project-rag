/**
 * Browser-side upload to a Supabase Storage signed URL, with progress.
 *
 * WHY NOT `supabase.storage.uploadToSignedUrl()`: it builds exactly the
 * FormData below and PUTs it with `fetch`, which reports no upload progress at
 * all. This sends the identical request over XMLHttpRequest, which does — so
 * the wire format is unchanged and only the transport differs. It is NOT a
 * hand-rolled binary PUT.
 */

export type UploadResult = { ok: true } | { ok: false; error: string };

export function uploadToSignedUrl(options: {
  signedUrl: string;
  file: File;
  /**
   * Derived from the extension. The bucket enforces `allowed_mime_types`
   * against the multipart part's content-type, and browsers report "" for .md
   * and .txt — which becomes application/octet-stream and is REJECTED. So the
   * File is re-wrapped with the canonical type before sending.
   */
  canonicalMime: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const { signedUrl, file, canonicalMime, onProgress, signal } = options;

  return new Promise<UploadResult>((resolve) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", new File([file], file.name, { type: canonicalMime }));

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          error: readError(xhr.responseText) ?? `Upload failed (${xhr.status}).`,
        });
      }
    };

    xhr.onerror = () => resolve({ ok: false, error: "Network error during upload." });
    xhr.onabort = () => resolve({ ok: false, error: "Upload cancelled." });

    if (signal) {
      if (signal.aborted) {
        resolve({ ok: false, error: "Upload cancelled." });
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(body);
  });
}

function readError(responseText: string): string | null {
  try {
    const parsed = JSON.parse(responseText) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? null;
  } catch {
    return null;
  }
}

/** Asks the server for a one-shot signed URL for a single file. */
export async function requestUploadUrl(input: {
  intent: "create" | "add";
  projectId?: string;
  file: File;
}): Promise<
  | {
      ok: true;
      projectId: string;
      documentId: string;
      storageKey: string;
      canonicalMime: string;
      signedUrl: string;
    }
  | { ok: false; error: string }
> {
  const response = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: input.intent,
      projectId: input.projectId,
      filename: input.file.name,
      mime: input.file.type,
      size: input.file.size,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, string>;
  if (!response.ok) {
    return { ok: false, error: payload.error ?? "Could not prepare the upload." };
  }
  return {
    ok: true,
    projectId: payload.projectId!,
    documentId: payload.documentId!,
    storageKey: payload.storageKey!,
    canonicalMime: payload.canonicalMime!,
    signedUrl: payload.signedUrl!,
  };
}
