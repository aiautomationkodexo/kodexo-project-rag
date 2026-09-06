"use client";

import { useActionState, useState } from "react";
import { Callout } from "@/components/ui/callout";
import { SubmitButton } from "@/components/ui/submit-button";
import { addFilesToProject, type ActionState } from "../actions";
import {
  NewProjectFilesProvider,
  useNewProjectFiles,
} from "../new/files-context";
import { FileDropzone } from "../new/file-dropzone";
import { requestUploadUrl, uploadToSignedUrl } from "@/lib/uploads/upload";

/** Adds documents to an existing project. Reuses the create form's queue. */
export function AddFiles({ projectId }: { projectId: string }) {
  return (
    <NewProjectFilesProvider>
      <Inner projectId={projectId} />
    </NewProjectFilesProvider>
  );
}

function Inner({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    addFilesToProject,
    {},
  );
  const { files, patch, reset } = useNewProjectFiles();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setUploadError(null);
    if (files.length === 0) {
      setUploadError("Attach at least one document.");
      return;
    }

    setUploading(true);
    const done: Record<string, unknown>[] = [];

    for (const queued of files) {
      patch(queued.id, { status: "uploading", progress: 0, error: undefined });

      const grant = await requestUploadUrl({
        intent: "add",
        projectId,
        file: queued.file,
      });
      if (!grant.ok) {
        patch(queued.id, { status: "error", error: grant.error });
        setUploading(false);
        setUploadError(`${queued.name}: ${grant.error}`);
        return;
      }

      const result = await uploadToSignedUrl({
        signedUrl: grant.signedUrl,
        file: queued.file,
        canonicalMime: grant.canonicalMime,
        onProgress: (p) => patch(queued.id, { progress: p }),
      });
      if (!result.ok) {
        patch(queued.id, { status: "error", error: result.error });
        setUploading(false);
        setUploadError(`${queued.name}: ${result.error}`);
        return;
      }

      patch(queued.id, { status: "uploaded", progress: 1 });
      done.push({
        documentId: grant.documentId,
        storageKey: grant.storageKey,
        filename: queued.name,
        mime: grant.canonicalMime,
        size: queued.size,
        docRole: queued.docRole,
      });
    }

    setUploading(false);
    formData.set("projectId", projectId);
    formData.set("files", JSON.stringify(done));
    formAction(formData);
    // The queue has been handed off; the live status panel takes over from here.
    reset();
  }

  return (
    <details className="mt-section">
      <summary className="cursor-pointer font-body text-label uppercase tracking-label text-n700 hover:text-ink">
        Add documents
      </summary>

      <form action={submit} className="mt-panel-y max-w-form">
        {state.error ? (
          <Callout variant="err" label="Could not add" className="mb-panel-y">
            <p className="mb-0">{state.error}</p>
          </Callout>
        ) : null}
        {uploadError ? (
          <Callout variant="err" label="Upload failed" className="mb-panel-y">
            <p className="mb-0">{uploadError}</p>
          </Callout>
        ) : null}

        <FileDropzone disabled={uploading} />

        <div className="mt-panel-y">
          {/* `default`, not `primary` — the detail page spends no red. */}
          <SubmitButton
            variant="default"
            pendingLabel={uploading ? "Uploading…" : "Adding…"}
            disabled={uploading || files.length === 0}
          >
            Add documents
          </SubmitButton>
        </div>

        <p className="mt-panel-y mb-0 text-small text-n500">
          The summary is regenerated once the new documents finish processing.
          Existing sections keep their facts.
        </p>
      </form>
    </details>
  );
}
