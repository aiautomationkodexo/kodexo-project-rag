/**
 * Public environment values — safe in the browser bundle.
 *
 * This module must NEVER import `server-only`: client components depend on it.
 * Server-only secrets live in `./env.ts`, which does.
 *
 * Each value is read via the literal `process.env.NEXT_PUBLIC_*` form. Next
 * inlines these at build time only when they appear literally in source — a
 * computed lookup like `process.env[name]` silently yields undefined in the
 * browser.
 */

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;

/**
 * Throws a named error rather than letting `createBrowserClient` fail with an
 * opaque message when the env file hasn't been filled in.
 */
export function assertSupabasePublicEnv(): void {
  if (!publicEnv.supabaseUrl || !publicEnv.supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
        "Copy .env.example to .env.local and fill it in — see SETUP.md.",
    );
  }
}
