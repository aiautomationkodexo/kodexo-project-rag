"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { setUserActive, softDeleteUser, type UserActionState } from "../actions";

/**
 * Deactivate / reactivate / soft delete.
 *
 * Follows delete-project.tsx's inline two-step pattern rather than a modal —
 * DESIGN.md has no dialog, and the Callout-based expansion is the established
 * affordance. Copied deliberately: a generic <ConfirmAction> with slots for
 * label/body/placeholder/match-value would be longer than its two call sites.
 */
export function DangerZone({
  userId,
  email,
  isActive,
  canUpdate,
  canDelete,
  isSelf,
}: {
  userId: string;
  email: string;
  isActive: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isSelf: boolean;
}) {
  const [state, activeAction] = useActionState<UserActionState, FormData>(
    setUserActive,
    {},
  );
  const [confirming, setConfirming] = useState(false);
  const [confirm, setConfirm] = useState("");

  if (!canUpdate && !canDelete) return null;

  return (
    <section className="mt-section border-t border-n200 pt-section">
      <h2 className="mb-panel-y font-display text-subhead font-bold">
        Account status
      </h2>

      {state.error ? (
        <Callout variant="err" label="Could not change" className="mb-panel-y">
          <p className="mb-0">{state.error}</p>
        </Callout>
      ) : null}
      {state.ok ? (
        <Callout variant="ok" label="Done" className="mb-panel-y">
          <p className="mb-0">{state.ok}</p>
        </Callout>
      ) : null}

      {canUpdate && !isSelf ? (
        <form action={activeAction} className="mb-panel-y">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="active" value={isActive ? "false" : "true"} />
          <SubmitButton
            variant="default"
            pendingLabel={isActive ? "Deactivating…" : "Reactivating…"}
          >
            {isActive ? "Deactivate account" : "Reactivate account"}
          </SubmitButton>
          <p className="mt-[6px] mb-0 text-small text-n500">
            {isActive
              ? "They are signed out on their next navigation and can no longer sign in."
              : "They will be able to sign in again."}
          </p>
        </form>
      ) : null}

      {isSelf ? (
        <Callout variant="info" label="This is you">
          <p className="mb-0">
            You cannot deactivate or delete your own account.
          </p>
        </Callout>
      ) : null}

      {canDelete && !isSelf ? (
        confirming ? (
          <Callout variant="err" label="Delete this user">
            <p className="mb-panel-y">
              The account is deactivated and hidden from every listing. Projects
              they created keep their name for attribution. Type their email to
              confirm.
            </p>
            <form action={softDeleteUser} className="max-w-form">
              <input type="hidden" name="userId" value={userId} />
              <Input
                aria-label="Type the email address to confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={email}
              />
              <div className="mt-panel-y flex items-center gap-gutter">
                <SubmitButton
                  variant="danger"
                  pendingLabel="Deleting…"
                  disabled={confirm.trim().toLowerCase() !== email.toLowerCase()}
                >
                  Delete permanently
                </SubmitButton>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Callout>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete user
          </Button>
        )
      ) : null}
    </section>
  );
}
