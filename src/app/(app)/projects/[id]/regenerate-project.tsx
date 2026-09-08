"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { regenerateProject, type ActionState } from "../actions";

/**
 * Rebuilds every derived artifact from the documents already processed.
 *
 * ── THIS IS THE VIEW'S ONE RED RUN ────────────────────────────────────────
 * It lives in PageHeader's `action` slot, which is that ration expressed
 * structurally — a single slot, not an array. Nothing else on the project
 * page claimed it. `variant="primary"` is therefore correct HERE and would be
 * wrong anywhere else on this page. DeleteProject's `danger` is a different
 * colour role, not a second red run.
 *
 * ── NOT RENDERED UNLESS THE PROJECT IS 'ready' ────────────────────────────
 * The caller gates on status, and that is both correct and load-bearing:
 * regenerateProject rejects a non-ready project, so an always-visible button
 * would offer an action that can only return an error. The gate doubles as
 * the rate limit — the button is unavailable for exactly the length of one
 * regeneration, which is why no cooldown column exists.
 *
 * No confirm dialog: the summary stays additive (existing section keys are
 * reused) so this is not destructive to curated content, and the two lists it
 * does rebuild are disposable model output by construction (0017).
 */
export function RegenerateProject({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    regenerateProject,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="projectId" value={projectId} />

      <SubmitButton variant="primary" pendingLabel="Regenerating…">
        Regenerate
      </SubmitButton>

      {state.error ? (
        <span className="mt-[4px] block max-w-[220px] text-small text-err-ink">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
