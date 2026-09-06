"use client";

import { useActionState } from "react";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateUserProfile, type UserActionState } from "../actions";

export function ProfileForm({
  userId,
  name,
  email,
}: {
  userId: string;
  name: string;
  email: string;
}) {
  const [state, formAction] = useActionState<UserActionState, FormData>(
    updateUserProfile,
    {},
  );

  return (
    <form action={formAction} className="max-w-form">
      <input type="hidden" name="userId" value={userId} />

      {state.error ? (
        <Callout variant="err" label="Could not save" className="mb-panel-y">
          <p className="mb-0">{state.error}</p>
        </Callout>
      ) : null}
      {state.ok ? (
        <Callout variant="ok" label="Saved" className="mb-panel-y">
          <p className="mb-0">{state.ok}</p>
        </Callout>
      ) : null}

      <Field label="Name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" defaultValue={name} placeholder="Full name" />
      </Field>

      <Field
        label="Email"
        htmlFor="email-readonly"
        hint={
          <span className="font-body text-label uppercase tracking-label text-n700">
            Cannot be changed
          </span>
        }
      >
        <Input id="email-readonly" defaultValue={email} disabled readOnly />
      </Field>
      <p className="-mt-[6px] mb-panel-y text-small text-n500">
        The email address is the sign-in identity, so it is immutable. Create a
        new account if someone&rsquo;s address changes.
      </p>

      <SubmitButton variant="default" pendingLabel="Saving…">
        Save
      </SubmitButton>
    </form>
  );
}
