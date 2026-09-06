# Setup

Everything the code cannot do for itself. Work top to bottom.

## 0. Prerequisites

- Node 22+ (this repo is developed on Node 24; the OpenAI SDK requires 22 LTS minimum)
- Docker, for the local Supabase stack
- A Supabase project (for deployment) and an OpenAI API key

```bash
npm install
cp .env.example .env.local
```

---

## 1. Local development (no cloud project, no API keys needed for most of it)

```bash
npm run db:start     # Postgres + pgvector + Auth + Realtime + Storage in Docker
npm run db:reset     # applies supabase/migrations/0001..0005 from scratch
npm run types:db     # regenerates src/lib/supabase/database.types.ts
```

`supabase/config.toml` is already configured for this app: signups disabled, 900s OTP expiry, both
`127.0.0.1` and `localhost` origins allow-listed, and the magic-link template pointed at
`supabase/templates/magic_link.html` (the `token_hash` form). You should not need to touch it.

`npm run db:start` prints an API URL, a publishable key and a secret key. Put them in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key from db:start>
SUPABASE_SECRET_KEY=<secret/service_role key from db:start>
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
INTERNAL_BASE_URL=http://127.0.0.1:3000
INTERNAL_SECRET=<openssl rand -hex 32>
SUPER_ADMIN_EMAIL=you@kodexolabs.com
SUPER_ADMIN_NAME=Your Name
OPENAI_API_KEY=<required for search and summaries>
```

Then:

```bash
npm run seed:admin   # creates the super admin, asserts has_claim(...) === true
npm run dev
```

**Local mail.** `db:start` includes Inbucket, a mail catcher — magic links appear there instead of a real inbox. The URL is in the `db:start` output (usually <http://127.0.0.1:54324>). This is what makes the whole auth flow testable with no Resend account.

> **Use `127.0.0.1` everywhere locally, never `localhost`.** Supabase compares redirect origins as
> strings, so `http://localhost:3000/auth/confirm` does not match a `127.0.0.1` allow-list entry —
> Supabase then silently falls back to Site URL and the magic link lands on `/` instead of
> `/auth/confirm`. Separately, `INTERNAL_BASE_URL` must be `127.0.0.1`, not `localhost`. Node resolves `localhost` to `::1` while `next dev` binds `0.0.0.0`, so the pipeline's self-call would get `ECONNREFUSED`.

---

## 2. Supabase dashboard (cloud project)

Local development needs none of this. Deployment needs all of it.

**Auth → Providers → Email**
- Disable sign-ups. Accounts are created by an admin only; `signInWithOtp` passes `shouldCreateUser: false`, and this closes the loop at the provider.
- OTP expiry: 900 seconds.

**Auth → URL Configuration**
- Site URL: your exact origin, no trailing slash.
- Redirect URLs — add **both**:
  - `{SITE_URL}/auth/confirm` ← the one that matters
  - `{SITE_URL}/auth/callback` ← fallback for an unedited email template

**Auth → Email Templates → Magic Link** — replace the body link with:

```html
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">Sign in</a></p>
```

This is not cosmetic. `@supabase/ssr` defaults to PKCE, and PKCE binds its code verifier to the device that *requested* the link. People request on a laptop and click in webmail on a phone, and corporate mail scanners pre-fetch URLs — both fail the default `?code=` exchange with an error that surfaces as "expired link" for a perfectly valid link. `token_hash` + `verifyOtp` has no device binding.

**Auth → SMTP** — Resend, via their Supabase integration (it fills in the settings and creates the key). Verify SPF/DKIM on the sending domain.

> Supabase throttles custom SMTP to **30 messages/hour** by default. Raise it in Auth → Rate Limits or sign-ins will silently start failing.

**JWT signing keys** — the proxy uses `getClaims()`, which verifies locally against a cached JWKS when the project uses asymmetric signing keys. That is the default for new projects. On an older project, migrate to asymmetric keys or `getClaims()` falls back to a network call per request.

**Storage / Realtime** — nothing to click. Migration `0004` creates the `project-files` bucket, its policies, and the Realtime publication.

---

## 3. Vercel

- **Plan: Pro is required**, not optional. `vercel.json` schedules the sweep every 5 minutes and Hobby allows only daily crons — the deployment fails otherwise.
- **Enable Fluid Compute.** `maxDuration = 800` on the processing routes only takes effect with it; the platform default is 300s. On by default for new projects.
- **Raise function memory to 4 GB** (default 2 GB) before T6 lands — document extraction peaks at several times the file size.
- Set every variable from `.env.example`. `CRON_SECRET` is provided automatically.
- Set `INTERNAL_BASE_URL` to the deployment origin.

---

## 4. Verifying the build

```bash
npm run typecheck    # next typegen && tsc --noEmit
npm run lint
npm run build
```

Acceptance criteria per PRD §14:

| Task | Criterion | How |
|---|---|---|
| T1 | dev serves, typecheck clean | `npm run dev`, `npm run typecheck` |
| T2 | migrations apply; seed idempotent; `has_claim` true | `npm run db:reset && npm run seed:admin && npm run seed:admin` |
| T3 | magic link signs in; signed-out redirects; deactivation forces logout | Inbucket; then `update profiles set is_active=false` and navigate |
| T4 | 200+ char description reaches `ready` and is findable by a semantically-related search sharing no exact words | Needs `OPENAI_API_KEY` |

To test deactivation:

```sql
update profiles set is_active = false where email = 'you@kodexolabs.com';
```
Then navigate anywhere — the next request routes through `/auth/signout?reason=deactivated` and lands on `/login?error=deactivated`.

---

## 5. Pipeline modes

`PIPELINE_MODE=http` (default) fans out one function invocation per document, each with its own 800s budget and memory.

`PIPELINE_MODE=inline` runs the pipeline in-process. Use it when exercising the pipeline from a script with no server running. Both modes call the identical `processDocument` / `maybeFinalize` core, so behaviour cannot diverge — only timeout and isolation do.
