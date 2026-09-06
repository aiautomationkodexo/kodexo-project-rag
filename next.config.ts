import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Stable in Next 16 (no longer under `experimental`).
  typedRoutes: true,

  /*
   * Next 16 rejects dev requests (including Server Action POSTs) whose Origin
   * it does not recognise, and it only trusts `localhost` by default.
   *
   * This app must be browsed at 127.0.0.1 locally, because Supabase compares
   * redirect origins as strings and its Site URL is http://127.0.0.1:3000 —
   * so `localhost` would break the magic-link redirect. Without this entry the
   * two requirements contradict each other and the login form fails to submit
   * with an opaque "Connection closed" 500.
   *
   * Development only; it has no effect on a production build.
   */
  allowedDevOrigins: ["127.0.0.1"],

  // Pre-wired for T6 document extraction. Listing a package that isn't
  // installed yet is a no-op, so this doesn't need touching at T6.
  serverExternalPackages: ["unpdf", "mammoth"],

  // Deliberately NOT set:
  //   cacheComponents — every authed route is force-dynamic; enabling it would
  //     mean restructuring each page around `use cache`/<Suspense> for no gain
  //     on a per-user-authorized app, and it removes the `dynamic`/`revalidate`
  //     segment configs entirely.
  //   webpack — Turbopack is the Next 16 default and a `webpack` key fails the build.
  //   experimental.authInterrupts — forbidden()/unauthorized() are still
  //     experimental; PRD §9 specifies redirect-for-pages / throw-for-actions.
};

export default nextConfig;
