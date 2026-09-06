import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env.public";
import type { Database } from "./database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * MUST be async and MUST be awaited at every call site: `cookies()` is async in
 * Next 15+, and it is awaited ONCE here, outside `createServerClient`. The
 * getAll/setAll callbacks stay synchronous, closing over the resolved store.
 *
 * This is the USER's client — RLS applies. For the pipeline's privileged work
 * use `createAdminClient()` from ./admin.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot set cookies.
            // Safe to ignore: the proxy refreshes sessions on every request.
            // (The `headers` second argument is deliberately unused here —
            // response headers can't be set from a Server Component either.
            // The proxy is responsible for applying them.)
          }
        },
      },
    },
  );
}
