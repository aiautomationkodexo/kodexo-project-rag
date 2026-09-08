"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { classifyFile } from "@/lib/uploads/mime";

/**
 * Queue state for the dropzone, shared with the form so the description
 * minimum can relax the moment a file is attached.
 */

export type UploadStatus = "queued" | "uploading" | "uploaded" | "error";

export type QueuedFile = {
  /** Local key. Becomes the `documents.id` once the upload URL is minted. */
  id: string;
  file: File;
  name: string;
  size: number;
  /** Derived from the extension, never trusted from the browser. */
  canonicalMime: string;
  /** Free text. "client testimonial", "kickoff call" — no enum, ever. */
  docRole: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  documentId?: string;
  storageKey?: string;
};

type Ctx = {
  files: QueuedFile[];
  /** Returns per-file rejection reasons so the caller can surface them. */
  add: (incoming: File[]) => string[];
  remove: (id: string) => void;
  setDocRole: (id: string, docRole: string) => void;
  patch: (id: string, changes: Partial<QueuedFile>) => void;
  reset: () => void;
};

const FilesContext = createContext<Ctx | null>(null);

export function NewProjectFilesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [files, setFiles] = useState<QueuedFile[]>([]);

  const add = useCallback((incoming: File[]): string[] => {
    const rejected: string[] = [];
    setFiles((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        const verdict = classifyFile({
          filename: file.name,
          declaredMime: file.type,
          size: file.size,
        });
        if (!verdict.ok) {
          rejected.push(`${file.name}: ${verdict.reason}`);
          continue;
        }
        // Cheap duplicate guard. It cannot catch "different bytes, identical
        // extracted text" (a .docx and .pdf of the same document) — that is
        // what the 23505 handler in process-document.ts is for — but it stops
        // the common case before any upload or embedding spend.
        if (next.some((f) => f.name === file.name && f.size === file.size)) {
          rejected.push(`${file.name}: already in the list.`);
          continue;
        }
        next.push({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          canonicalMime: verdict.canonicalMime,
          docRole: "",
          status: "queued",
          progress: 0,
        });
      }
      return next;
    });
    return rejected;
  }, []);

  // Every mutator returns a NEW array/object. The React Compiler assumes
  // immutability; mutating in place silently fails to re-render.
  const remove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const setDocRole = useCallback((id: string, docRole: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, docRole } : f)));
  }, []);

  const patch = useCallback((id: string, changes: Partial<QueuedFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...changes } : f)));
  }, []);

  const reset = useCallback(() => setFiles([]), []);

  const value = useMemo(
    () => ({ files, add, remove, setDocRole, patch, reset }),
    [files, add, remove, setDocRole, patch, reset],
  );

  return <FilesContext.Provider value={value}>{children}</FilesContext.Provider>;
}

export function useNewProjectFiles(): Ctx {
  const ctx = useContext(FilesContext);
  if (!ctx) {
    throw new Error("useNewProjectFiles must be used within NewProjectFilesProvider");
  }
  return ctx;
}
