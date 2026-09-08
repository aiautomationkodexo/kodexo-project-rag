"use client";

import { useActionState } from "react";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { GRANT_PRESETS } from "@/lib/auth/claim-set";
import {
  grantProjectAccess,
  revokeProjectAccess,
  type UserActionState,
} from "../actions";

export type ProjectGrant = {
  projectId: string;
  title: string | null;
  claims: string[];
};

/**
 * Per-project access for one user.
 *
 * ── WHAT THIS PANEL IS AND IS NOT ─────────────────────────────────────────
 * Grants are purely ADDITIVE (migration 0018): adding a row can never remove
 * anyone's access, and there is no deny primitive. So this panel widens access
 * and the claims grid above it is still what decides portfolio-wide rights. A
 * user holding a global projects:view sees everything regardless of what is
 * listed here — which is why the empty state says so rather than implying the
 * user is restricted.
 */
export function GrantsForm({
  userId,
  grants,
  hasGlobalView,
}: {
  userId: string;
  grants: ProjectGrant[];
  hasGlobalView: boolean;
}) {
  const [state, formAction] = useActionState<UserActionState, FormData>(
    grantProjectAccess,
    {},
  );

  return (
    <div>
      {hasGlobalView ? (
        <Callout label="Portfolio-wide access">
          This user holds the global <strong>View projects</strong> claim, so
          they can already see every project. Per-project grants below add
          nothing until that claim is removed above.
        </Callout>
      ) : null}

      {state.error ? (
        <Callout variant="err" label="Could not grant access">
          {state.error}
        </Callout>
      ) : null}

      {grants.length === 0 ? (
        <p className="mb-panel-y text-small text-n500">
          No per-project grants.
        </p>
      ) : (
        <ul className="mb-panel-y list-none p-0">
          {grants.map((g) => (
            <li
              key={g.projectId}
              className="flex flex-wrap items-center justify-between gap-cell-x border-b border-n200 py-cell-y last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-body text-list text-ink [overflow-wrap:anywhere]">
                  {/* A null title means the project is outside THIS admin's
                      own visibility. Showing the id is more honest than
                      hiding a grant they are entitled to manage. */}
                  {g.title ?? g.projectId}
                </span>
                <span className="mt-[2px] flex flex-wrap gap-[4px]">
                  {g.claims.map((c) => (
                    <Chip key={c}>{c.replace("projects:", "")}</Chip>
                  ))}
                </span>
              </span>

              {/* Revoke is a separate non-state form: it takes no input and
                  throws rather than returning state, matching DangerZone. */}
              <form action={revokeProjectAccess}>
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="projectId" value={g.projectId} />
                <Button type="submit" variant="ghost" size="sm">
                  Revoke
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />

        <Field
          label="Project id"
          htmlFor="grant-project"
          hint={
            <span className="font-body text-label uppercase tracking-label text-n700">
              From the project URL
            </span>
          }
        >
          {/* A UUID box rather than a project picker: a picker would have to
              list every project the admin can see, which on a large portfolio
              is a second paginated surface. The id is in the URL of the page
              they just came from. */}
          <Input
            id="grant-project"
            name="projectId"
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
        </Field>

        <Field label="Access level" htmlFor="grant-preset">
          <Select id="grant-preset" name="preset" defaultValue="Viewer">
            {Object.keys(GRANT_PRESETS).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>

        <SubmitButton variant="default" pendingLabel="Granting…">
          Grant access
        </SubmitButton>
      </form>
    </div>
  );
}
