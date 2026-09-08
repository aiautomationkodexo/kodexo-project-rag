import { redirect } from "next/navigation";
import type { Route } from "next";
import { Logo } from "@/components/chrome/logo";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { sendMagicLink } from "./actions";

// Never prerender or cache an auth surface.
export const dynamic = "force-dynamic";

/**
 * /login is the app's COVER.
 *
 * DESIGN.md §5.13 TextCover is the one print component with a real app
 * analogue, and this is the only screen that is pure identity with no data:
 * logo → 2.5px red rule → AI ENGINEERING kicker → Anton h1. It is also the
 * only legitimate use of --font-hyper in the entire app; if this composition
 * ever goes away, delete Anton rather than leave an unused family loaded.
 */
export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;

  /*
   * SAFETY NET for a misconfigured redirect allow-list.
   *
   * When Supabase does not recognise `emailRedirectTo` it silently falls back
   * to the project's Site URL, so a magic link lands on "/" carrying its auth
   * parameter. Signed out, the proxy then rewrites that to /login while
   * cloning the query string — and this page used to read only `sent` and
   * `error`, so the code was discarded and the user saw a bare login form with
   * no explanation and a burnt token.
   *
   * Forward it to the route that knows what to do with it instead. The real
   * fix is the allow-list (supabase/config.toml locally, the dashboard in
   * production — SETUP.md §2); this makes the failure recoverable rather than
   * silent.
   */
  const code = typeof params.code === "string" ? params.code : null;
  const tokenHash =
    typeof params.token_hash === "string" ? params.token_hash : null;
  const otpType = typeof params.type === "string" ? params.type : "magiclink";

  if (tokenHash) {
    redirect(
      `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(otpType)}` as Route,
    );
  }
  if (code) {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}` as Route);
  }

  const sent = params.sent === "1";
  const error = typeof params.error === "string" ? params.error : null;

  // No self-service recovery exists for a deactivated account, and offering the
  // form would invite a loop.
  const showForm = !sent && error !== "deactivated";

  return (
    /*
     * THE COVER, centred as a card.
     *
     * DESIGN.md §5.13 TextCover is the one print component with a real app
     * analogue, and this is the app's only screen that is pure identity with
     * no data: logo → 2.5px red rule → AI ENGINEERING kicker → Anton h1.
     * It is also the only legitimate use of --font-hyper in the entire app; if
     * this composition ever goes away, delete Anton rather than leave an
     * unused family loaded.
     *
     * The reference sign-in screen centres a bordered card on a tinted ground.
     * Here the ground is n50 and the card is white with the standard n200
     * hairline plus `elev-md` — the middle SOT elevation. This is the one
     * screen that earns more than `elev-sm`: the card floats alone on an empty
     * page with no surrounding content to give it depth, which is exactly the
     * case the larger shadow exists for.
     */
    <main className="flex min-h-full flex-1 items-center justify-center bg-n50 px-shell py-section">
      <div className="w-full max-w-[430px]">
        <div className="mb-panel-y flex flex-col items-center">
          <Logo height={30} priority />
          <div className="mt-[6px] border-b-[2.5px] border-red pb-[3px]">
            <span className="font-body text-label font-semibold uppercase tracking-kicker text-red">
              AI Engineering
            </span>
          </div>
        </div>

        <div className="elev-md rounded-md border border-n200 bg-white px-section py-section">
          <h1 className="mb-panel-y font-hyper text-[32px] uppercase leading-[1.02] tracking-[0.005em] text-ink">
            Portfolio
            <br />
            Knowledge Base
          </h1>

          <p className="mb-section text-small text-n500">
            Sign in with a magic link. Accounts are created by an administrator
            — there is no self-service sign-up.
          </p>

          {sent ? (
            <Callout variant="ok" label="Link sent">
              <p className="mb-0">
                If that address has an account, a sign-in link is on its way. It
                expires in 15 minutes.
              </p>
              <p className="mb-0 mt-[6px] text-small text-n500">
                <a href="/login" className="underline underline-offset-2">
                  Use a different address
                </a>
              </p>
            </Callout>
          ) : null}

          {error === "expired" ? (
            <Callout variant="warn" label="Link expired" className="mb-panel-y">
              <p className="mb-0">
                That sign-in link has expired or was already used. Request a new
                one below.
              </p>
            </Callout>
          ) : null}

          {error === "deactivated" ? (
            <Callout variant="err" label="Access revoked">
              <p className="mb-0">
                This account has been deactivated. Contact an administrator.
              </p>
            </Callout>
          ) : null}

          {error === "invalid" ? (
            <Callout variant="warn" label="Check the address" className="mb-panel-y">
              <p className="mb-0">That does not look like an email address.</p>
            </Callout>
          ) : null}

          {showForm ? (
            <form action={sendMagicLink}>
              <Field label="Work email" htmlFor="email" required>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@kodexolabs.com"
                />
              </Field>
              {/* The view's one red run. */}
              <SubmitButton
                variant="primary"
                pendingLabel="Sending…"
                className="w-full"
              >
                Send magic link
              </SubmitButton>
            </form>
          ) : null}
        </div>

        <p className="mt-panel-y mb-0 text-center text-caption text-n500">
          Access is limited to authorized Kodexo Labs accounts.
        </p>
      </div>
    </main>
  );
}
