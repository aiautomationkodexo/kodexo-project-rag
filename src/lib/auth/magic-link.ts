import "server-only";

import { sendMagicLinkEmail } from "@/lib/email/magic-link";
import { publicEnv } from "@/lib/env.public";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Minimum gap between magic-link emails to one address.
 *
 * This exists because we no longer use GoTrue's mailer, and therefore no longer
 * get its per-address resend interval (the "you can only request this after N
 * seconds" 429). Without it the public login form is an unthrottled way to spam
 * a known user's inbox and burn the daily sending quota.
 */
const RESEND_INTERVAL_MS = 60_000;

/**
 * Issues a magic link and delivers it over OUR SMTP transport.
 *
 * WHY NOT signInWithOtp: GoTrue's mailer is rate limited on two axes — a
 * per-address resend interval and an hourly cap — and both are low enough to
 * interrupt ordinary use. auth.admin.generateLink() mints the same token,
 * sends nothing, and is not rate limited (verified: four back-to-back calls all
 * succeeded where signInWithOtp 429s on the second).
 *
 * ⚠ THE TRAP: generateLink CREATES the user when the address is unknown. There
 * is no shouldCreateUser option. Called naively this turns /login into an open
 * relay — anyone could POST a stranger's address and we would email them a
 * working sign-in link — and it breaks the admin-only account rule (PRD §3).
 * VERIFIED against a real project: an invented address produced a live
 * auth.users row.
 *
 * The profile pre-check below is what prevents that, and it must stay FIRST.
 * profiles.id references auth.users(id) ON DELETE CASCADE, so a profile row
 * existing is proof the auth user exists — meaning generateLink can only ever
 * adopt an account here, never create one.
 *
 * TOTAL: never throws. The caller must not learn whether the address exists
 * (PRD §8), so there is nothing useful it could do with an exception anyway.
 */
export async function issueMagicLink(email: string): Promise<void> {
  try {
    const admin = createAdminClient();

    // Gate 1: the address must belong to an ACTIVE, non-deleted profile.
    //
    // Also an improvement on the old flow: a deactivated user used to receive a
    // link, sign in, and only then get bounced by the proxy. Now they get no
    // mail at all. profiles_select never references deleted_at, so filtering it
    // here in the app layer is required (see CLAUDE.md).
    const { data: profile, error } = await admin
      .from("profiles")
      .select("id, name, last_magic_link_at")
      .eq("email", email)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      console.error(`[login] profile lookup failed: ${error.message}`);
      return;
    }
    if (!profile) {
      console.warn(`[login] no active profile for ${email} — nothing sent`);
      return;
    }

    // Gate 2: resend throttle.
    if (profile.last_magic_link_at) {
      const elapsed = Date.now() - Date.parse(profile.last_magic_link_at);
      if (elapsed < RESEND_INTERVAL_MS) {
        console.warn(
          `[login] throttled ${email} — ${Math.ceil((RESEND_INTERVAL_MS - elapsed) / 1000)}s remaining`,
        );
        return;
      }
    }

    // Mints the token WITHOUT sending anything.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error(`[login] generateLink failed: ${linkError?.message ?? "no token_hash"}`);
      return;
    }

    // Built by hand rather than using properties.action_link, which points at
    // the Supabase domain and round-trips through GoTrue's own redirect. This
    // goes straight to our /auth/confirm, which is verifyOtp + token_hash —
    // no PKCE, so no device binding (see that route for why that matters).
    const url =
      `${publicEnv.siteUrl}/auth/confirm` +
      `?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`;

    const sent = await sendMagicLinkEmail({ to: email, name: profile.name, url });

    // Stamped only on a confirmed send, so a failed delivery does not lock the
    // address out for the throttle window.
    if (sent) {
      await admin
        .from("profiles")
        .update({ last_magic_link_at: new Date().toISOString() })
        .eq("id", profile.id);
    }
  } catch (err) {
    console.error("[login] issueMagicLink failed:", err);
  }
}
