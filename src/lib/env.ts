import "server-only";

/**
 * Server-side environment access.
 *
 * PRD §15.7: `service_role` (now SUPABASE_SECRET_KEY) never reaches the client.
 * The `server-only` import above turns any client-component import of this
 * module into a build error, so the invariant is enforced by the compiler
 * rather than by convention.
 *
 * Public values live in `./env.public.ts`, which must NOT import `server-only`
 * because client components need it.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill it in — see SETUP.md.`,
    );
  }
  return value;
}

/** Server-only secrets. Throws on first access if unset. */
export const serverEnv = {
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY);
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  },
  get internalSecret() {
    return required("INTERNAL_SECRET", process.env.INTERNAL_SECRET);
  },
  /** Origin the app uses to call itself for the processing fan-out. */
  get internalBaseUrl() {
    return (
      process.env.INTERNAL_BASE_URL ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      "http://127.0.0.1:3000"
    );
  },
  /**
   * 'http'   — one function invocation per document (production).
   * 'inline' — run the pipeline in-process (local dev / tests, no server).
   */
  get pipelineMode(): "http" | "inline" {
    return process.env.PIPELINE_MODE === "inline" ? "inline" : "http";
  },
  get chatModel() {
    return process.env.OPENAI_CHAT_MODEL;
  },
} as const;
