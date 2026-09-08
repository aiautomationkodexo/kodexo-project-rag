"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { setDocumentActive, type ActionState } from "../actions";

/**
 * Removes one document from the project (`is_active = false`).
 *
 * A form per row, as VisibilityToggle explains: each row is an independent
 * write, and `useFormStatus` inside SubmitButton scopes pending to its own
 * form.
 *
 * ── THE LABEL SAYS "REMOVE DOCUMENT", NOT "REMOVE" ────────────────────────
 * VisibilityToggle sits immediately beside this and already reads "Remove
 * from index". Two adjacent ghost buttons both beginning "Remove" is a
 * genuine misclick trap, and the two actions are very different: one hides a
 * document from search while leaving it on the project, the other takes it
 * off the project entirely. The title attribute carries the distinction that
 * will not fit in a label.
 *
 * Only the removal direction is offered here. getProject filters
 * `is_active = true`, so a removed document is not in this list to restore
 * from — see setDocumentActive's note on that known limit. The action itself
 * handles both directions.
 */
export function RemoveDocument({
  projectId,
  documentId,
}: {
  projectId: string;
  documentId: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    setDocumentActive,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="active" value="false" />

      <SubmitButton
        variant="ghost"
        size="sm"
        pendingLabel="Removing…"
        title="Takes this document off the project and regenerates the summary. The file and its text are kept."
      >
        Remove document
      </SubmitButton>

      {state.error ? (
        <span className="ml-[6px] text-small text-err-ink">{state.error}</span>
      ) : null}
    </form>
  );
}
