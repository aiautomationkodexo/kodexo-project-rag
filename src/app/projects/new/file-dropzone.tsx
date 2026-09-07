"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { formatBytes, MAX_FILES_PER_PROJECT } from "@/lib/uploads/mime";
import { useNewProjectFiles, type QueuedFile } from "./files-context";

/**
 * Mirrors EXTENSION_MIMES in @/lib/uploads/mime. Without the media entries the
 * OS file picker filters them out and drag-and-drop is the only way to add a
 * recording — the file is accepted, but the button appears not to work.
 */
const ACCEPT = ".txt,.md,.pdf,.docx,.pptx,.mp3,.wav,.m4a,.mp4,.mov";

/**
 * The file queue. Files are NOT uploaded here — they are uploaded by whoever
 * owns the submit (the create form, or the add-files form), because the upload
 * must be interleaved with minting the project id.
 *
 * React Compiler: the input ref is only ever read inside handlers, never during
 * render.
 */
export function FileDropzone({ disabled }: { disabled?: boolean }) {
  const { files, add, remove, setDocRole } = useNewProjectFiles();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const full = files.length >= MAX_FILES_PER_PROJECT;

  function accept(list: FileList | null) {
    if (!list || list.length === 0) return;
    const room = MAX_FILES_PER_PROJECT - files.length;
    const incoming = Array.from(list);
    const tooMany =
      incoming.length > room
        ? [`Only ${MAX_FILES_PER_PROJECT} files per project — ${incoming.length - room} skipped.`]
        : [];
    setRejected([...tooMany, ...add(incoming.slice(0, Math.max(room, 0)))]);
  }

  return (
    <div>
      <span className="mb-[6px] block font-body text-label uppercase tracking-label text-n700">
        Documents
      </span>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !full) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled && !full) accept(e.dataTransfer.files);
        }}
        className={`rounded-box border px-panel-x py-panel-y ${
          dragging ? "border-n800 bg-n50" : "border-n300"
        } ${disabled || full ? "opacity-60" : ""}`}
      >
        <p className="mb-panel-y text-body text-n500">
          Drop files here, or{" "}
          <button
            type="button"
            disabled={disabled || full}
            onClick={() => inputRef.current?.click()}
            className="underline underline-offset-2 disabled:no-underline"
          >
            choose files
          </button>
          .
        </p>
        {/* Two lines because the two caps are genuinely different and one
            sentence cannot carry both without implying the smaller applies to
            everything. */}
        <p className="mb-0 text-label uppercase tracking-label text-n500">
          PDF · DOCX · PPTX · TXT · MD — up to 50 MB each
        </p>
        <p className="mb-0 text-label uppercase tracking-label text-n500">
          MP3 · WAV · M4A · MP4 · MOV — up to 200 MB each, transcribed
          automatically
        </p>
        <p className="mb-0 text-label uppercase tracking-label text-n500">
          {MAX_FILES_PER_PROJECT} per project
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          disabled={disabled || full}
          className="hidden"
          onChange={(e) => {
            accept(e.target.files);
            // Allow re-selecting the same file after a removal.
            e.target.value = "";
          }}
        />
      </div>

      {rejected.length > 0 ? (
        <Callout variant="warn" label="Not added" className="mt-panel-y">
          <ul className="mb-0 list-none space-y-[4px] p-0 text-list">
            {rejected.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {files.length > 0 ? (
        <ul className="mt-panel-y list-none space-y-[9px] p-0">
          {files.map((file) => (
            <QueuedRow
              key={file.id}
              file={file}
              disabled={disabled}
              onRemove={() => remove(file.id)}
              onDocRole={(v) => setDocRole(file.id, v)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function QueuedRow({
  file,
  disabled,
  onRemove,
  onDocRole,
}: {
  file: QueuedFile;
  disabled?: boolean;
  onRemove: () => void;
  onDocRole: (value: string) => void;
}) {
  return (
    <li
      className={`rounded-box border px-panel-x py-panel-y ${
        file.status === "uploading" ? "border-[1.5px] border-n800" : "border-n200"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-gutter">
        <span className="min-w-0 font-body text-list font-bold [overflow-wrap:anywhere]">
          {file.name}
        </span>
        <span className="flex items-center gap-[8px]">
          <span className="text-small text-n500">{formatBytes(file.size)}</span>
          {file.status === "uploaded" ? <Chip tone="ok">uploaded</Chip> : null}
          {file.status === "error" ? <Chip tone="err">failed</Chip> : null}
          {file.status === "queued" && !disabled ? (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              Remove
            </Button>
          ) : null}
        </span>
      </div>

      {file.status === "uploading" ? (
        // A 2px rule, not a pill or a shadow: borders carry state in this
        // system. Percentage text does the real reporting.
        <div className="mt-[8px]">
          <div className="h-[2px] w-full bg-n200">
            <div
              className="h-[2px] bg-ink transition-[width]"
              style={{ width: `${Math.round(file.progress * 100)}%` }}
            />
          </div>
          <span className="mt-[4px] block text-label uppercase tracking-label text-n700">
            Uploading {Math.round(file.progress * 100)}%
          </span>
        </div>
      ) : null}

      {file.error ? (
        <p className="mt-[6px] mb-0 text-small text-err-ink">{file.error}</p>
      ) : null}

      {file.status === "queued" ? (
        <div className="mt-[8px]">
          <label
            htmlFor={`role-${file.id}`}
            className="mb-[4px] block font-body text-label uppercase tracking-label text-n700"
          >
            What is this document?
          </label>
          <Input
            id={`role-${file.id}`}
            value={file.docRole}
            disabled={disabled}
            onChange={(e) => onDocRole(e.target.value)}
            placeholder="e.g. client testimonial, final report"
          />
        </div>
      ) : file.docRole ? (
        <p className="mt-[6px] mb-0 text-small text-n500">{file.docRole}</p>
      ) : null}
    </li>
  );
}
