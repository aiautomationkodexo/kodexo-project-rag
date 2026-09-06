import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";

/**
 * FALLBACK magic-link landing route: the PKCE ?code= exchange.
 *
 * /auth/confirm is the one to configure (see that file). This exists so a
 * default, unedited Supabase email template — which sends ?code= — still works
 * during initial setup instead of hard-failing with a confusing error.
 *
 * Add BOTH URLs to the Supabase redirect allow-list.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    redirect("/login?error=expired");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Most likely cause: the link was opened on a different device from the one
    // that requested it, so the PKCE verifier cookie is absent.
    redirect("/login?error=expired");
  }

  // Only internal relative paths — an open redirect on an authenticated
  // session would be a phishing vector. The cast is needed because
  // typedRoutes expects a literal, and this destination is runtime data.
  const target =
    next?.startsWith("/") && !next.startsWith("//") ? next : "/projects";
  redirect(target as Route);
}
