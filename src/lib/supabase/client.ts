"use client";

import { createBrowserClient } from "@supabase/ssr";
import { assertSupabasePublicEnv, publicEnv } from "@/lib/env.public";
import type { Database } from "./database.types";

/**
 * Browser Supabase client.
 *
 * Lazy module singleton. `createBrowserClient` is itself internally memoized,
 * but going through this accessor keeps the construction out of component
 * render paths: with the React Compiler enabled, reading a mutable module
 * binding during render is impure and may be memoized around unexpectedly.
 *
 * Call it inside an effect or an event handler. If you genuinely need it during
 * render, use `useState(() => getBrowserClient())` — never a bare call in the
 * component body.
 */
let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getBrowserClient() {
  if (!cached) {
    assertSupabasePublicEnv();
    cached = createBrowserClient<Database>(
      publicEnv.supabaseUrl,
      publicEnv.supabasePublishableKey,
    );
  }
  return cached;
}
