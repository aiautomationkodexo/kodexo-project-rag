"use client";

import { useActionState } from "react";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { NDA_STATUSES } from "@/lib/projects/disclosure";
import { setNdaStatus, type ActionState } from "../actions";

/**
 * Sets disclosure terms. Rendered ONLY when the viewer holds
 * projects:set-nda — offering a control that is guaranteed to 42501 is worse
 * than not offering it, and this one would: migration 0013 revokes the column
 * grant, so the write is only possible through the RPC the action calls.
 */
export function NdaForm({
  projectId,
  ndaStatus,
}: {
  projectId: string;
  ndaStatus: string | null;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    setNdaStatus,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="projectId" value={projectId} />

      {state.error ? (
        <Callout variant="err" label="Could not save">
          {state.error}
        </Callout>
      ) : null}

      <Field
        label="Disclosure terms"
        htmlFor="nda-status"
        error={state.fieldErrors?.ndaStatus}
        hint={
          <span className="font-body text-label uppercase tracking-label text-n700">
            Human decision only
          </span>
        }
      >
        <Select id="nda-status" name="nda_status" defaultValue={ndaStatus ?? ""}>
          {/* "" clears the field back to "nobody has decided", which
              disclosure() treats exactly like Permanently Excluded. */}
          <option value="">Not reviewed</option>
          {NDA_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Field>

      <SubmitButton variant="default" pendingLabel="Saving…">
        Save disclosure terms
      </SubmitButton>
    </form>
  );
}
