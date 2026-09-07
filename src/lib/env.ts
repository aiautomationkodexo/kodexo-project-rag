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
  /**
   * Origin the app uses to call itself for the processing fan-out.
   *
   * NO localhost fallback. On Vercel that default produced ECONNREFUSED on
   * every dispatch, and BOTH callers swallow fetch failures by design — so
   * documents stayed in 'queued', the cron sweep re-POSTed into the same void,
   * and the project never left 'processing'. Nothing ever threw.
   *
   * That is also why callers must read this OUTSIDE their try/catch: a throw
   * from here caught by dispatch's deliberately-swallowing catch would restore
   * the exact silent failure it exists to prevent. See dispatch.ts.
   *
   * VERCEL_URL is the current deployment's origin, which is what a self-call
   * wants on previews as well as production. CAVEAT: with Deployment
   * Protection on, a self-call to it is answered by a 401 login page rather
   * than the route — set INTERNAL_BASE_URL explicitly on protected
   * environments.
   */
  get internalBaseUrl(): string {
    const explicit =
      process.env.INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
    if (explicit) return explicit.replace(/\/+$/, "");
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return required("INTERNAL_BASE_URL", undefined);
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
  /**
   * REQUIRED, like openaiApiKey — deliberately not soft-optional.
   *
   * It is only ever read on the audio/video extraction path, so a deployment
   * that never uploads media never touches it. When it IS missing, throwing a
   * plain Error is the correct outcome: that is the pipeline's TRANSIENT class,
   * so the document retries and the operator gets three cron cycles of grace to
   * set the variable, instead of a permanently failed document blaming a
   * recording that was fine.
   *
   * See the 401 argument in ai/deepgram.ts — a WRONG key is classified the same
   * way for the same reason, so the two operator mistakes behave identically.
   */
  get deepgramApiKey() {
    return required("DEEPGRAM_API_KEY", process.env.DEEPGRAM_API_KEY);
  },
  /**
   * SMTP transport for the completion email. SOFT-OPTIONAL on purpose: returns
   * undefined rather than throwing when unset.
   *
   * required() here would be a bug. The completion email is a courtesy sent
   * after the project's terminal status has already committed; a missing
   * variable must degrade to a logged no-op, never to a throw on the
   * pipeline's success path (PRD §15.9).
   *
   * Magic-link mail does NOT come through here — GoTrue sends it over the same
   * SMTP account, configured in supabase/config.toml [auth.email.smtp] and
   * applied with `npm run config:push`. One credential, two consumers.
   */
  get smtp():
    | { host: string; port: number; user: string; password: string; from: string }
    | undefined {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;
    const from = process.env.EMAIL_FROM;
    if (!host || !user || !password || !from) return undefined;
    return {
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      user,
      // Google displays App Passwords as four space-separated groups
      // ("abcd efgh ijkl mnop") and people paste them verbatim. SMTP AUTH
      // takes the 16 characters, so strip whitespace rather than failing with
      // an "invalid credentials" error that looks like the wrong password.
      password: password.replace(/\s+/g, ""),
      from,
    };
  },
} as const;
