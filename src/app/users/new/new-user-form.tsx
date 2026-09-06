"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { ClaimsGrid } from "../claims-grid";
import { createUser, type UserActionState } from "../actions";
import type { Claim } from "@/lib/auth/claim-set";

export function NewUserForm({
  actor,
}: {
  actor: { isSuperAdmin: boolean; claims: Claim[] };
}) {
  const [state, formAction] = useActionState<UserActionState, FormData>(
    createUser,
    {},
  );

  return (
    <form action={formAction} className="max-w-form">
      {state.error ? (
        <Callout variant="err" label="Could not create" className="mb-panel-y">
          <p className="mb-0">{state.error}</p>
        </Callout>
      ) : null}

      <Field
        label="Email"
        htmlFor="email"
        required
        error={state.fieldErrors?.email}
        hint={
          <span className="font-body text-label uppercase tracking-label text-n700">
            Their sign-in identity
          </span>
        }
      >
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="off"
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          placeholder="name@kodexolabs.com"
        />
      </Field>

      <Field label="Name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" autoComplete="off" placeholder="Full name" />
      </Field>

      <ClaimsGrid actor={actor} initial={["projects:view"]} />
      {state.fieldErrors?.claims ? (
        <Callout variant="err" label="Permissions" className="mb-panel-y">
          <p className="mb-0">{state.fieldErrors.claims}</p>
        </Callout>
      ) : null}

      <div className="mt-section flex items-center gap-gutter">
        {/* The view's one red run. */}
        <SubmitButton variant="primary" pendingLabel="Creating…">
          Create user
        </SubmitButton>
        <Link href="/users">
          <Button variant="ghost">Cancel</Button>
        </Link>
      </div>

      <p className="mt-panel-y mb-0 text-small text-n500">
        No invitation email is sent. Tell them their account is ready — they sign
        in with a magic link from the login page.
      </p>
    </form>
  );
}
