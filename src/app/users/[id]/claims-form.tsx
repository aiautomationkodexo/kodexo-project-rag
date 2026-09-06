"use client";

import { useActionState } from "react";
import { Callout } from "@/components/ui/callout";
import { SubmitButton } from "@/components/ui/submit-button";
import { ClaimsGrid } from "../claims-grid";
import { updateUserClaims, type UserActionState } from "../actions";
import type { Claim } from "@/lib/auth/claim-set";

export function ClaimsForm({
  userId,
  actor,
  initial,
  isSuperAdmin,
  canEdit,
}: {
  userId: string;
  actor: { isSuperAdmin: boolean; claims: Claim[] };
  initial: Claim[];
  isSuperAdmin: boolean;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<UserActionState, FormData>(
    updateUserClaims,
    {},
  );

  if (isSuperAdmin) {
    return (
      <Callout variant="info" label="Super admin">
        <p className="mb-0">
          This account holds every permission implicitly, so it carries no
          individual permission rows. Super admin status cannot be changed
          through the app — it is granted only by the seed script.
        </p>
      </Callout>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />

      {state.error ? (
        <Callout variant="err" label="Could not save" className="mb-panel-y">
          <p className="mb-0">{state.error}</p>
        </Callout>
      ) : null}
      {state.fieldErrors?.claims ? (
        <Callout variant="err" label="Permissions" className="mb-panel-y">
          <p className="mb-0">{state.fieldErrors.claims}</p>
        </Callout>
      ) : null}
      {state.ok ? (
        <Callout variant="ok" label="Saved" className="mb-panel-y">
          <p className="mb-0">{state.ok}</p>
        </Callout>
      ) : null}

      {/* `key` remounts the grid when the saved set changes, so it reflects
          the server's view rather than stale local state. */}
      <ClaimsGrid
        key={initial.join(",")}
        actor={actor}
        initial={initial}
        disabled={!canEdit}
      />

      {canEdit ? (
        <SubmitButton variant="default" pendingLabel="Saving…">
          Save permissions
        </SubmitButton>
      ) : null}
    </form>
  );
}
