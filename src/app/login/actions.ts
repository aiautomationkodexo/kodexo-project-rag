"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";

import { issueMagicLink } from "@/lib/auth/magic-link";

/**
 * Magic-link request.
 *
 * ALWAYS redirects to /login?sent=1 regardless of outcome (PRD §8). Reporting
 * whether the address exists would be an account-enumeration oracle, and only
 * pre-provisioned people are allowed to sign in at all.
 *
 * MAIL DOES NOT GO THROUGH SUPABASE. GoTrue's mailer is rate limited on two
 * axes — a per-address resend interval and an hourly cap — and both are low
 * enough to interrupt ordinary use ("you can only request this after 6
 * seconds"). issueMagicLink mints the token with auth.admin.generateLink(),
 * which sends nothing and is not rate limited, and delivers it over our own
 * SMTP transport. See that module for the trap this avoids.
 *
 * Registered with after() rather than awaited, for two reasons:
 *
 *   1. It closes a TIMING oracle. Awaiting means a known address costs a
 *      generateLink round trip plus an SMTP handshake while an unknown one
 *      returns immediately — measurable, and enough to enumerate accounts
 *      through the very response the §8 rule exists to make uniform.
 *   2. The form returns immediately instead of blocking on SMTP.
 *
 * after() MUST be registered BEFORE redirect(): redirect() throws
 * NEXT_REDIRECT, so anything after it is unreachable (the same trap documented
 * for the ingestion pipeline in CLAUDE.md).
 */
export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@")) {
    redirect("/login?error=invalid");
  }

  // issueMagicLink is total — it never throws, and it logs its own failures.
  after(() => issueMagicLink(email));

  redirect("/login?sent=1");
}
