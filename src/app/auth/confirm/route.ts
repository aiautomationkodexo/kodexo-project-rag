import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import type { Route } from "next";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * PRIMARY magic-link landing route: token_hash + verifyOtp.
 *
 * Why not exchangeCodeForSession? @supabase/ssr defaults to the PKCE flow, and
 * PKCE stores its code verifier in a cookie ON THE DEVICE THAT REQUESTED THE
 * LINK. People request a link on a laptop and open it in webmail on a phone,
 * and corporate mail scanners pre-fetch URLs. In both cases the exchange fails
 * with "both auth code and code verifier should be non-empty" — which surfaces
 * to the user as an expired link, for a link that is perfectly valid.
 *
 * verifyOtp has no device binding. Security is unchanged: the link is a bearer
 * token either way, bounded by the 900s OTP expiry configured in Supabase.
 *
 * REQUIRES the Magic Link email template to be:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink
 * See SETUP.md.
 */

// Whitelist rather than trusting the query string.
const VALID_TYPES: EmailOtpType[] = ["magiclink", "email", "invite", "recovery"];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  if (!tokenHash || !type || !VALID_TYPES.includes(type)) {
    redirect("/login?error=expired");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    redirect("/login?error=expired");
  }

  // Only allow internal relative paths — an open redirect here would be a
  // phishing vector on an authenticated session.
  // Only internal relative paths — an open redirect on an authenticated
  // session would be a phishing vector. The cast is needed because
  // typedRoutes expects a literal, and this destination is runtime data.
  const target =
    next?.startsWith("/") && !next.startsWith("//") ? next : "/projects";
  redirect(target as Route);
}
