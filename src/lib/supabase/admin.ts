import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { publicEnv } from "@/lib/env.public";
import type { Database } from "./database.types";

/**
 * Service-role client. BYPASSES RLS ENTIRELY.
 *
 * §15.7: never reaches the client. The `server-only` import above makes any
 * client-component import a build error.
 *
 * Constructed per call, never module-scope: on Vercel Fluid compute a warm
 * instance is shared across requests, and a module-scope client holding
 * user-specific state can leak one user's session into another's request.
 *
 * Use ONLY where RLS must be bypassed by design:
 *   - the ingestion pipeline (writes chunks, reads raw_text across documents)
 *   - the cron sweep
 *   - the admin seed script
 * Everything user-facing goes through ./server, so RLS stays a live check.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    publicEnv.supabaseUrl,
    serverEnv.supabaseSecretKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
