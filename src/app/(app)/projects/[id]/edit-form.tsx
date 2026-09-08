"use client";

import { useActionState } from "react";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateProject, type ActionState } from "../actions";
import { MetaFields } from "../meta-fields";
import { LinksField } from "../links-field";

export function EditForm({
  projectId,
  title,
  description,
  engagementType,
  startDate,
  endDate,
  teamSize,
  links,
}: {
  projectId: string;
  title: string;
  description: string;
  engagementType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  teamSize?: number | null;
  /** Existing links, pre-rendered one per line in the paste format. */
  links?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateProject,
    {},
  );

  return (
    <details className="mt-section">
      <summary className="cursor-pointer font-body text-label uppercase tracking-label text-n700 hover:text-ink">
        Edit project
      </summary>

      <form action={formAction} className="mt-panel-y max-w-form">
        <input type="hidden" name="projectId" value={projectId} />

        {state.error ? (
          <Callout variant="err" label="Could not save" className="mb-panel-y">
            <p className="mb-0">{state.error}</p>
          </Callout>
        ) : null}

        <Field label="Project title" htmlFor="edit-title" required error={state.fieldErrors?.title}>
          <Input id="edit-title" name="title" defaultValue={title} required />
        </Field>

        <Field
          label="Description"
          htmlFor="edit-description"
          required
          error={state.fieldErrors?.description}
          hint={
            <span className="font-body text-label uppercase tracking-label text-n700">
              Editing re-runs the summary
            </span>
          }
        >
          <Textarea
            id="edit-description"
            name="description"
            rows={10}
            defaultValue={description}
          />
        </Field>

        <MetaFields
          idPrefix="edit"
          errors={state.fieldErrors}
          engagementType={engagementType}
          startDate={startDate}
          endDate={endDate}
          teamSize={teamSize}
        />

        <LinksField idPrefix="edit" defaultValue={links} />

        {/* `default`, not `primary`: the page's red ration is not spent here. */}
        <SubmitButton variant="default" pendingLabel="Saving…">
          Save changes
        </SubmitButton>
      </form>
    </details>
  );
}
