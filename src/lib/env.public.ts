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

  /**
   * THROWS when unset. There is deliberately no fallback.
   *
   * The failure it prevents is invisible: an emailRedirectTo origin that is not
   * in Supabase's redirect allow-list is SILENTLY replaced by Site URL — no
   * error, no log. The magic link then lands on `/` instead of /auth/confirm,
   * verifyOtp never runs, no session is created, and sendMagicLink cannot
   * report any of it because §8 requires the response not to branch on `error`.
   * The only symptom is "sign-in doesn't work", with a 200 and a clean log.
   *
   * A getter, not a module-scope check: client components import this module
   * for supabaseUrl, and a top-level throw would break the browser bundle for
   * all of them. `siteUrl` has exactly one reader — sendMagicLink — which is
   * server-side. Next's build-time inlining is unaffected: it substitutes on
   * the literal `process.env.NEXT_PUBLIC_SITE_URL` token wherever it appears,
   * getter body included.
   *
   * The trailing-slash strip is not cosmetic. `.env.example` warns "NO trailing
   * slash" and nothing enforced it; one slash yields `https://host//auth/confirm`,
   * which is not byte-equal to the allow-list entry, and Supabase compares
   * origins as strings.
   */
  get siteUrl(): string {
    const raw = process.env.NEXT_PUBLIC_SITE_URL;
    if (!raw) {
      throw new Error(
        "Missing required environment variable: NEXT_PUBLIC_SITE_URL. " +
          "It is inlined at BUILD time — setting it only in the runtime " +
          "environment is not enough. See SETUP.md.",
      );
    }
    return raw.replace(/\/+$/, "");
  },
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
