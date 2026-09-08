"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { setDocumentVisibility, type ActionState } from "../actions";

/**
 * Flips one document in or out of the index.
 *
 * A form per row rather than one form with a row selector: each row is an
 * independent write, and a shared form would need client state to track which
 * row is pending. `useFormStatus` inside SubmitButton already scopes the
 * pending state to its own form.
 */
export function VisibilityToggle({
  projectId,
  documentId,
  visibility,
}: {
  projectId: string;
  documentId: string;
  visibility: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    setDocumentVisibility,
    {},
  );
  const next = visibility === "no_index" ? "indexed" : "no_index";

  return (
    <form action={formAction} className="mt-[6px]">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="visibility" value={next} />

      <SubmitButton
        variant="ghost"
        size="sm"
        pendingLabel={next === "no_index" ? "Removing…" : "Re-indexing…"}
      >
        {next === "no_index" ? "Remove from index" : "Add back to index"}
      </SubmitButton>

      {state.error ? (
        <span className="ml-[6px] text-small text-err-ink">{state.error}</span>
      ) : null}
    </form>
  );
}
