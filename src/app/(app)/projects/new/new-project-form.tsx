"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { createProject, type ActionState } from "../actions";
import { requestUploadUrl, uploadToSignedUrl } from "@/lib/uploads/upload";
import { descriptionMinFor, TITLE_MIN } from "@/lib/projects/validate";
import {
  NewProjectFilesProvider,
  useNewProjectFiles,
} from "./files-context";
import { FileDropzone } from "./file-dropzone";

/**
 * `dropzone` is the T6 slot. Passing it in from page.tsx means T6 adds a file
 * and one prop, and touches nothing in here.
 */
export function NewProjectForm({ dropzone }: { dropzone?: React.ReactNode }) {
  return (
    <NewProjectFilesProvider>
      <Inner dropzone={dropzone} />
    </NewProjectFilesProvider>
  );
}

function Inner({ dropzone }: { dropzone?: React.ReactNode }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    createProject,
    {},
  );
  const { files, patch } = useNewProjectFiles();
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /*
   * Files go straight to Storage BEFORE the action runs — that is what keeps a
   * 50 MB PDF away from Vercel's 4.5 MB request-body limit. The action then
   * receives only the metadata.
   *
   * All files in one submission share a project id, minted by the first
   * upload-url call and echoed back on the rest, so every object lands under
   * the same prefix and the project row is inserted with that same id.
   */
  async function submit(formData: FormData) {
    setUploadError(null);

    if (files.length > 0) {
      setUploading(true);
      let projectId: string | undefined;
      const done: Record<string, unknown>[] = [];

      for (const queued of files) {
        patch(queued.id, { status: "uploading", progress: 0, error: undefined });

        const grant = await requestUploadUrl({
          intent: "create",
          projectId,
          file: queued.file,
        });
        if (!grant.ok) {
          patch(queued.id, { status: "error", error: grant.error });
          setUploading(false);
          setUploadError(`${queued.name}: ${grant.error}`);
          return;
        }
        projectId = grant.projectId;

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

        patch(queued.id, {
          status: "uploaded",
          progress: 1,
          documentId: grant.documentId,
          storageKey: grant.storageKey,
        });
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
      formData.set("files", JSON.stringify(done));
    }

    formAction(formData);
  }

  const min = descriptionMinFor(files.length);
  const short = description.trim().length < min;

  return (
    <form action={submit} className="max-w-form">
      {state.error ? (
        <Callout variant="err" label="Could not save" className="mb-panel-y">
          <p className="mb-0">{state.error}</p>
        </Callout>
      ) : null}

      <Field
        label="Project title"
        htmlFor="title"
        required
        error={state.fieldErrors?.title}
      >
        <Input
          id="title"
          name="title"
          required
          minLength={TITLE_MIN}
          aria-invalid={state.fieldErrors?.title ? true : undefined}
          placeholder="Aurora Freight Rebuild"
        />
      </Field>

      <Field
        label="Description"
        htmlFor="description"
        required={min > 0}
        error={state.fieldErrors?.description}
        hint={
          min > 0 ? (
            <span
              className={`font-body text-label uppercase tracking-label ${
                touched && short ? "text-err-ink" : "text-n700"
              }`}
            >
              {description.trim().length} / {min}
            </span>
          ) : (
            <span className="font-body text-label uppercase tracking-label text-n700">
              Optional — files attached
            </span>
          )
        }
      >
        <Textarea
          id="description"
          name="description"
          rows={10}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={state.fieldErrors?.description ? true : undefined}
          placeholder="What was the problem, what was built, what changed as a result? The more specific, the better the search results."
        />
      </Field>

      <section className="mb-panel-y">
        {dropzone ?? <FileDropzone disabled={uploading} />}
      </section>

      {uploadError ? (
        <Callout variant="err" label="Upload failed" className="mb-panel-y">
          <p className="mb-0">{uploadError}</p>
        </Callout>
      ) : null}

      <div className="mt-section flex items-center gap-gutter">
        {/* The view's one red run. */}
        <SubmitButton
          variant="primary"
          pendingLabel={uploading ? "Uploading…" : "Creating…"}
          disabled={uploading}
        >
          Create project
        </SubmitButton>
        <Link href="/projects">
          <Button variant="ghost">Cancel</Button>
        </Link>
      </div>

      <p className="mt-panel-y mb-0 text-small text-n500">
        Processing starts immediately and continues in the background. You can
        close the page.
      </p>
    </form>
  );
}
