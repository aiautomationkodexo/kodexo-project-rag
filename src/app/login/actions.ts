"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env.public";

/**
 * Magic-link request.
 *
 * ALWAYS redirects to /login?sent=1 regardless of outcome (PRD §8). Reporting
 * whether the address exists would be an account-enumeration oracle, and the
 * whole point of `shouldCreateUser: false` is that only pre-provisioned people
 * can sign in.
 */
export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@")) {
    redirect("/login?error=invalid");
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      // Points at /auth/confirm, which uses verifyOtp + token_hash. See the
      // route file for why that is preferred over the ?code= exchange.
      emailRedirectTo: `${publicEnv.siteUrl}/auth/confirm`,
    },
  });

  /*
   * The RESPONSE never branches on `error` — that is what prevents account
   * enumeration, and it must stay that way.
   *
   * But swallowing the error entirely made every failure mode identical and
   * undiagnosable: a rate limit, an unknown address, and a broken email
   * template all rendered "Link sent". Log it server-side so the cause is
   * visible in the console while the user-facing behaviour is unchanged.
   *
   * Common causes, in rough order of likelihood while developing:
   *   · "For security purposes, you can only request this after Ns"
   *       or "email rate limit exceeded" → [auth.rate_limit] email_sent
   *   · "Signups not allowed for otp" → the address has no account, and
   *       shouldCreateUser is false by design (PRD §8)
   *   · a 500 → the magic-link template failed to render
   */
  if (error) {
    console.error(
      `[login] signInWithOtp failed (status ${error.status ?? "?"}): ${error.message}` +
        (process.env.NODE_ENV === "production" ? "" : ` — address: ${email}`),
    );
  }

  redirect("/login?sent=1");
}
