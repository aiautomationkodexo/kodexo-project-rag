import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next 16 renamed the `middleware.ts` convention to `proxy.ts`. Having both
 * files present is a hard build error. With the `src/` layout this file must
 * live inside `src/`, as a sibling of `app/`.
 *
 * The runtime is nodejs and is FIXED — `export const runtime` is forbidden
 * here and will throw. `revalidatePath`/`revalidateTag` cannot be called from
 * a proxy either.
 *
 * WHAT THIS FILE IS NOT: it is not the security boundary. The proxy runs on
 * every matched request including link prefetches, and a matcher change or a
 * refactor can silently remove coverage. Authorization is re-proven in every
 * Server Action (`assertClaim`) and enforced by RLS in the database. This layer
 * only refreshes the session cookie and keeps signed-out users off app pages.
 *
 * Deliberately NO database call here. Next's own auth guide says to keep proxy
 * checks optimistic and "avoid database checks"; adding one would also undo the
 * entire point of getClaims() being network-free. The `is_active` check lives
 * in getCurrentUser() instead — see src/lib/auth/claims.ts.
 */

const PUBLIC_PATHS = [
  "/login",
  "/auth/confirm",
  "/auth/callback",
  "/auth/error",
  "/auth/signout",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { response, claims } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Signed in and heading to /login → send them to the app.
  if (claims && pathname === "/login") {
    return redirectPreservingCookies(request, response, "/projects");
  }

  if (!claims && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were going so login can bounce them back.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return redirectPreservingCookies(request, response, url);
  }

  // IMPORTANT: return the response object from updateSession as-is. Creating a
  // fresh NextResponse without copying its cookies over desynchronises the
  // browser and server and terminates the session prematurely.
  return response;
}

/**
 * A redirect built from scratch would drop the refreshed auth cookies, and the
 * user would ping-pong between /login and the page they asked for.
 */
function redirectPreservingCookies(
  request: NextRequest,
  from: NextResponse,
  to: string | URL,
) {
  const url = typeof to === "string" ? new URL(to, request.url) : to;
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets AND /api.
     *
     * EXCLUDING /api IS LOAD-BEARING. Those routes authenticate themselves —
     * /api/process and /api/finalize with INTERNAL_SECRET, /api/cron/sweep with
     * a bearer token — and they are called machine-to-machine with no session
     * cookie. Left in the matcher, the proxy redirects them to /login with a
     * 307; `fetch` follows redirects by default, so dispatch() would receive a
     * cheerful 200 from the login page, nothing would throw, and every document
     * would sit in `queued` forever while the cron sweep meant to rescue them
     * was redirected too.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
