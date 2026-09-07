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
 *
 * ── Never offer an action the database will refuse ─────────────────────────
 * Two guards make deactivate/delete impossible before they are attempted:
 * `setUserActive`/`softDeleteUser` reject acting on yourself, and the
 * `guard_super_admin` trigger (0001) rejects removing the last active super
 * admin. Both are knowable at render time, so both suppress the controls and
 * say why in their place — the same principle as PRD §12's disabled claim
 * checkboxes: "the DB blocks it anyway, but the UI shouldn't offer it".
 *
 * Rendering the buttons and surfacing the trigger's error afterwards is worse
 * than useless: it reads as a bug in the app rather than as a rule.
 */
export function DangerZone({
  userId,
  email,
  isActive,
  canUpdate,
  canDelete,
  isSelf,
  isLastSuperAdmin,
}: {
  userId: string;
  email: string;
  isActive: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isSelf: boolean;
  isLastSuperAdmin: boolean;
}) {
  const [state, activeAction] = useActionState<UserActionState, FormData>(
    setUserActive,
    {},
  );
  const [confirming, setConfirming] = useState(false);
  const [confirm, setConfirm] = useState("");

  if (!canUpdate && !canDelete) return null;

  /*
   * ONE reason, not both. isSelf takes precedence because it is absolute —
   * promoting a second super admin clears isLastSuperAdmin but still leaves
   * you unable to act on your own account, so it is the binding constraint
   * and the only honest thing to show.
   */
  const blocked = isSelf ? "self" : isLastSuperAdmin ? "last-super-admin" : null;

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

      {canUpdate && !blocked ? (
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

      {blocked === "self" ? (
        <Callout variant="info" label="This is you">
          <p className="mb-0">
            You cannot deactivate or delete your own account. Someone else with
            permission to manage users has to do it.
          </p>
        </Callout>
      ) : null}

      {blocked === "last-super-admin" ? (
        <Callout variant="info" label="Last super admin">
          <p className="mb-0">
            This is the only active super admin, so it cannot be deactivated or
            deleted — the database refuses the write, and the app will not offer
            it. Promote another account with the seed script first, then retire
            this one.
          </p>
        </Callout>
      ) : null}

      {canDelete && !blocked ? (
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
