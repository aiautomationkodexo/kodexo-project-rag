import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env.public";
import type { Database } from "./database.types";

export type SessionResult = {
  response: NextResponse;
  /** Verified JWT claims, or null when there is no session. */
  claims: Record<string, unknown> | null;
};

/**
 * Refreshes the auth session and returns the response carrying the refreshed
 * cookies.
 *
 * Called from src/proxy.ts on every matched request.
 */
export async function updateSession(
  request: NextRequest,
): Promise<SessionResult> {
  let response = NextResponse.next({ request });

  // Per-request client. Never hoist to module scope — see admin.ts.
  const supabase = createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // The `headers` second argument (@supabase/ssr 0.10.0+) carries
          // Cache-Control / Expires / Pragma directives. Applying them is NOT
          // optional: without it a CDN can cache a response containing a
          // Set-Cookie header and hand one user's session to another.
          // This is the highest-severity line in the auth layer.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // ── Do not run code between createServerClient and getClaims(). ──────────
  // A mistake here makes users appear to be randomly logged out, and it is
  // extremely hard to debug.
  //
  // getClaims() verifies the JWT locally via WebCrypto against a cached JWKS —
  // zero network round-trip — while still refreshing an expired session.
  // It returns a THREE-way union: { data, error:null } | { data:null, error } |
  // { data:null, error:null }, where the last means "no session at all".
  // So the check is `data?.claims`, never `!error`.
  const { data } = await supabase.auth.getClaims();

  return { response, claims: data?.claims ?? null };
}
