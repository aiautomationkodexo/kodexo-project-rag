# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An internal portfolio knowledge base: projects are described or documented, the text is chunked and embedded, an LLM maintains an additive open-section summary, and projects are found by hybrid (vector + full-text) search.

- **[PRD.md](PRD.md)** — the implementation spec. Still the source of truth for *intent* and for the §15 invariants. Its *mechanics* are Next 15-era; see Deviations below.
- **[DESIGN.md](DESIGN.md)** — Kodexo Labs design system. Print-first (A4, `pt`); §9 is the web translation.
- **[SETUP.md](SETUP.md)** — everything the code cannot do for itself (Supabase dashboard, Vercel, local stack).

Built through PRD §14 **T1–T6**, plus a security migration (`0007`) and the §10 completion email. Not yet built: **T7** (Deepgram audio/video) and **T8** (tag approve/merge, audit-log writes, orphaned-storage cleanup in the cron sweep).

## Read the shipped Next docs, not your training data

`node_modules/next/AGENTS.md` says verbatim: *"This is NOT the Next.js you know… Read the relevant guide in `dist/docs/` before writing any code."* Next 16.3.4 ships version-matched docs at `node_modules/next/dist/docs/`. Consult those before writing framework code — several Next 15 patterns are removed, not merely deprecated.

## Commands

```bash
npm run dev
npm run build
npm run typecheck    # next typegen && tsc --noEmit — typegen FIRST, see below
npm run lint

npm run db:link      # link to the cloud project (writes supabase/.temp/project-ref)
npm run db:diff      # db push --linked --dry-run
npm run db:status    # migration list --linked
npm run db:push      # prints the target ref, then applies 0001..0007
npm run config:push  # auth settings, SMTP, redirect list, magic-link template
npm run buckets:push # storage bucket via the Storage REST API (0004 fallback)
npm run types:db     # regenerate src/lib/supabase/database.types.ts (--linked)
npm run build:sql    # regenerate supabase/setup.sql from migrations/ + seed/
npm run verify:cloud # post-push smoke test (add -- --send-mail to send one)
npm run seed:admin -- <project-ref>   # idempotent; asserts has_claim(...) === true
```

**Cloud-only. There is no local Supabase stack** — `db:start`/`db:stop`/`db:reset`
were removed deliberately: `supabase db reset` against a linked project wipes the
remote database, and with one target that target is production. `seed:admin` refuses
to run unless you name the project ref.

`config:push` and `buckets:push` shell the CLI through
`node --env-file-if-exists=.env.local` on purpose — `env(SMTP_PASSWORD)` in
`config.toml` resolves from the **process** environment at push time, so the bare CLI
would write an empty SMTP password to the project.

`typecheck` must run `next typegen` first: a clean checkout has no `.next/types`, and the global `PageProps` / `LayoutProps` / `RouteContext` helpers live there. Bare `tsc --noEmit` fails.

No test runner is configured yet. PRD §14 defines acceptance criteria per task; the additive-summary regression test belongs at T6.

## Layout

`src/app/`, `src/lib/`, `src/proxy.ts`, with `@/*` → `./src/*`.

**Prefix every path in PRD §2 with `src/`.** The PRD puts `app/` and `lib/` at the project root with `@/*` → root; this repo keeps the scaffold's `src/`, and Next 16 requires `proxy.ts` inside `src/` when that layout is used.

## Deviations from the PRD

Every §15 invariant is preserved; only mechanics changed.

| PRD | Here | Why |
|---|---|---|
| `middleware.ts` at root | `src/proxy.ts` exporting `proxy()` | Deprecated in 16; both files present is a hard build error |
| insert → `redirect()` → `after()` | insert → `after()` → `revalidatePath()` → `redirect()` | `redirect()` throws `NEXT_REDIRECT`, so the PRD's dispatch is unreachable — **no project would ever process** |
| `@supabase/ssr@0.5.2`, `cookies:{get,set,remove}` | `^0.12.6`, `{getAll,setAll}` | Old pair ERESOLVEs; old cookie API is typed `…Deprecated`. `setAll`'s 2nd `headers` arg is mandatory |
| `getUser()` in middleware + per-request `profiles` query | `getClaims()` in proxy; `is_active` in `getCurrentUser()` | `getClaims()` is local WebCrypto — zero network. Proxy runs on prefetches; Next's auth guide says avoid DB checks there |
| `exchangeCodeForSession` | `verifyOtp` + `token_hash` (callback kept as fallback) | PKCE's verifier is device-bound; a link opened in phone webmail fails and looks "expired" |
| `openai@4`, JSON mode, `gpt-4o-mini` | `openai@7`, Structured Outputs, `OPENAI_CHAT_MODEL` | `.parse()` moved off `.beta`. `strict: true` guarantees the section-array shape |
| `pdf-parse@1.1.1` | deferred to T6, then `unpdf` | `^1.1.1` resolves to 1.1.4 (28 MB of 2018 pdf.js); v2 needs native `@napi-rs/canvas` |
| `ANON_KEY` / `SERVICE_ROLE_KEY` | `PUBLISHABLE_KEY` / `SECRET_KEY` | Current Supabase key naming |
| `tsx` | Node native type stripping | `process.features.typescript === 'strip'` on Node 24 |
| Local Docker stack + cloud | **cloud-only**; `config.toml` is pushed, not local-dev config | One target, no drift. `supabase config push` makes auth settings + the magic-link template reviewable artifacts instead of dashboard clicks |
| Resend (SMTP + API) | **Google SMTP + App Password**, `nodemailer` | Resend cannot deliver to anyone but the account owner until a domain is verified via SPF/DKIM, and we have no DNS access — every user but one could not sign in. Env vars are provider-neutral (`SMTP_*`) so switching back is config, not code |
| `signInWithOtp` sends the magic link | `generateLink()` + **our own SMTP** | GoTrue's mailer is rate limited per-address AND hourly; both interrupt ordinary use ("only request this after 6 seconds"). `generateLink` mints the same token, sends nothing, and is not rate limited |

Added: `zod`, `server-only` (enforces §15.7 at build time), `supabase` CLI, ESLint flat config (`next lint` is gone), and a `claim_document()` RPC.

**Do not copy the PRD's SQL verbatim** — `supabase/migrations/` fixes twelve defects in it, each annotated inline. The most consequential: the FTS CTE had `LIMIT 60` with no `ORDER BY` (kept an arbitrary 60 rows); `search_path = public` allowed `pg_temp` privilege escalation through every `security definer` helper; a failed document stranded its project in `processing` forever; RLS was never actually enabled on any table; and **soft delete was impossible** — `projects_select` filters `deleted_at is null`, and Postgres checks the NEW row of an UPDATE against the SELECT policy, so writing `deleted_at` made the row invisible to its own writer (`0006_soft_delete.sql` routes it through a definer RPC that applies the same `projects:delete` check); and **PRD §5 shipped a live privilege escalation** — `profiles_update_self` allowed a self-update with no column restriction while Supabase's default grants gave `authenticated` UPDATE on `is_super_admin`, so any signed-in user could `PATCH` themselves to super admin (`0007_privilege_lockdown.sql`: column grants + a transition trigger; verified 403).

## Architecture

**Ingestion.** Create action inserts the project plus a *synthetic document* (`is_synthetic`, `storage_key: null`, `raw_text` = the description) so a description-only project flows through the ordinary pipeline. Then `after()` → `dispatch()` → `POST /api/process/{id}` at concurrency 4.

`PIPELINE_MODE=http` (default) gives each document its own invocation, its own `maxDuration = 800`, and its own memory — necessary because `after()` runs within *its own route's* budget, and a page's Server Action does not get 800s. `PIPELINE_MODE=inline` runs the same core in-process for local work. Both call the identical `processDocument` / `maybeFinalize`.

**§15.6 — finalization has exactly one gate.** `maybeFinalize()` calls `claim_finalize`, a single conditional `UPDATE`; Postgres picks one winner among however many workers think they are last. There is no application-level "am I last?" check and there must never be one. Two ordering traps: call it *after* the `status='done'` write commits, and call it on the **error** path too (a failed document is no longer pending).

**`/api` is excluded from the proxy matcher, and that is load-bearing.** Those routes authenticate themselves (internal secret / cron bearer) and are called machine-to-machine with no cookie. Left in the matcher they get a 307 to `/login`; `fetch` follows redirects, so `dispatch()` would receive a 200 from the login page, nothing would throw, and every document would sit in `queued` forever.

**Authorization is three layers, each with a different job:** `src/proxy.ts` verifies the JWT signature locally and keeps signed-out users off pages (0 network calls, no DB); `getCurrentUser()` checks `is_active`/`deleted_at` once per render via React `cache()`; RLS is the actual boundary. The proxy is *not* a security boundary — a matcher change can silently remove coverage, so every Server Action calls `assertClaim` itself.

**Claims only (§15.1).** `has_claim()` in SQL, `can(user, claim)` in TS. `is_super_admin` is the single flag and short-circuits to true — so **a super admin correctly has ZERO rows in `user_claims`** and still passes every claim check. Empty is not missing privileges; `grant_default_claims` skips super admins deliberately. There is no role string anywhere; do not introduce one.

**Search.** One RPC, `search_projects`: pgvector + Postgres FTS fused by RRF (`1/(60+rank)`). Filters are pre-filters inside the SQL. Scoring is **max-pooled** per project (`DISTINCT ON`) — summing would favour long documents; do not "fix" it. `min_similarity` defaults to 0.30, not the PRD's 0.15, or the floor admits everything and §15.5 is unenforceable. PostgREST cannot express vector operators, so similarity queries *must* go through `.rpc()`. Embeddings go through `toVector()` in [src/lib/supabase/vector.ts](src/lib/supabase/vector.ts): the type generator emits `vector` as `string`, and **both** a JSON array and a JSON string were verified to work against a real PostgREST — the widely-repeated "never `JSON.stringify` an embedding" warning does not apply here.

**Summaries are open-section.** `summary` is an ordered array of `{key,label,content}`. What makes regeneration non-destructive is prompt rule 1 (reuse keys exactly) — it is load-bearing. `summary_text` is the flattened form for embedding and is never a substitute for iterating the array.

## Uploads and extraction (T6)

Files go **straight to Storage** from the browser via a signed URL, keeping 50 MB payloads away from Vercel's 4.5 MB body limit. `/api/upload-url` mints both the document id and (on create) the project id, so the storage key and the row agree with no second round trip and no staging bucket.

- **`/api/upload-url` is the only cookie-authenticated route under `/api`.** It authenticates itself with `getCurrentUser()`. Do not add `/api` back to the proxy matcher to "fix" it — that 307s the machine routes.
- **Upload progress needs `XMLHttpRequest`.** `uploadToSignedUrl` builds a FormData and PUTs it with `fetch`, which reports no progress; `src/lib/uploads/upload.ts` sends the byte-identical request over XHR.
- **Re-wrap the File with the canonical MIME before sending.** Browsers report `""` for `.md`/`.txt`, which becomes `application/octet-stream`, and the bucket's `allowed_mime_types` rejects it.
- **PPTX slides sort numerically.** Lexicographic gives `slide1, slide10, slide2` and scrambles a deck without ever throwing — the text is all present, so it survives a glance in QA and only surfaces as incoherent summaries.
- **Permanent vs transient failures.** `PermanentExtractionError` (no text layer, not a real pptx, unsupported type) marks a document `failed` immediately. Retrying a malformed file three times can never succeed and holds the whole project in `processing` for ~15 minutes.
- **Duplicate extracted text** hits `documents_project_hash_idx` (23505). Handled as a *semantic* outcome — chunks deleted, document `failed` with a naming message, `attempts` maxed. Letting it reach the generic retry path stranded the project permanently with no visible error.
- **`addFilesToProject` sets `projects.status = 'processing'` BEFORE dispatching.** `claim_finalize` only fires on `processing`; adding files to a `ready` project without the reset means it returns false forever and no re-summary happens.

## Constraints that bite silently

- **§15.12 lives in `src/app/projects/[id]/summary-sections.tsx`** — the only component touching `summary.sections`. No `switch`, no `if`, no lookup keyed on `s.key`; array order unconditionally; a `.sort()` is a bug.
- **Never `.sort()` in the search render path.** `queries.ts` returns RRF order; re-sorting destroys the ranking.
- **Never render the search `score`** — an RRF sum in the 0.008–0.033 range. Any percentage or bar fabricates calibration.
- **No highlighting on snippets.** A top result can share zero words with the query (that *is* T4's acceptance criterion), so highlighting would misrepresent the ranking.
- **§15.10** — `src/lib/projects/queries.ts` uses explicit column lists. `select("*")` is banned there.
- **Each `?q=` render costs an OpenAI embedding.** The filter form submits explicitly; never debounce on keypress.
- **`profiles` queries must filter `.is("deleted_at", null)` in the app layer.** Unlike `projects_select`, the `profiles_select` policy never references `deleted_at`, so RLS will happily return soft-deleted users.
- **Claim writes go through the USER's client, never the admin client.** The per-row `has_claim(uid, claim)` arm of `claims_insert`/`claims_delete` *is* the "cannot grant what you don't hold" guarantee; the admin client bypasses RLS and silently voids it.
- **`is_super_admin` is not settable through the API at all** (`0007`). The seed script is the only way to mint one.
- **`internalBaseUrl` and `internalSecret` must be read OUTSIDE the try in `dispatch()` and the cron sweep.** Both catches swallow on purpose, so a config error read inside one is logged and discarded — leaving every document in `queued` with nothing raised anywhere. Hoisting is what lets the throw escape.
- **The completion email is dispatched from `maybeFinalize`, never from inside `finalizeProject`.** §15.9's try/catch lives in the latter; keeping mail outside it means no edit to the mail path can flip a successful finalize into the error branch. `notifyProjectReady` is total — it never throws — and `serverEnv.smtp` is soft-optional for the same reason: a `required()` throw there would be caught by §15.9's catch and silently degrade summaries.
- **`supabase/setup.sql` is GENERATED — never edit it.** `npm run build:sql` concatenates `supabase/migrations/*.sql` then `supabase/seed/*.sql`; a hand edit is discarded by the next build. It is the portable one-file path for a fresh project (and for moving Supabase accounts); `db push` is still the normal path for a linked one. Not idempotent as a whole by design — it stops at the first `create table` rather than half-modifying an existing install.
- **`generateLink()` CREATES the user when the address is unknown** — there is no `shouldCreateUser` option, and this is verified against a real project. The active-profile lookup at the top of `src/lib/auth/magic-link.ts` is the only thing standing between `/login` and an open mail relay; it must stay FIRST. `profiles.id` references `auth.users(id)` ON DELETE CASCADE, so a profile existing proves the auth user exists — which is what makes "adopt, never create" hold.
- **We own the magic-link resend throttle now.** Bypassing GoTrue's mailer also bypassed its per-address interval. `RESEND_INTERVAL_MS` + `profiles.last_magic_link_at` replace it; deleting that check re-opens inbox spamming through a public form.
- **`sendMagicLink` registers `issueMagicLink` with `after()`, not `await`.** Awaiting makes a known address cost a round trip plus an SMTP handshake while an unknown one returns instantly — a timing oracle that defeats the §8 uniform response. `after()` must be registered BEFORE `redirect()`, which throws `NEXT_REDIRECT`.
- **A super admin created in raw SQL needs `confirmation_token`, `recovery_token`, `email_change_token_new` and `email_change` set to `''`, never NULL.** They are nullable with no default, but GoTrue scans them into non-nullable Go strings — leave them NULL and every lookup fails with "Database error finding user". The account then exists, looks perfect in the dashboard, and simply cannot sign in. `supabase/seed/0100_super_admin.sql` sets them and self-heals rows created before this was understood.
- **Migration `0004` fails soft.** `db push` stops at the first error, so an unguarded failure there strands `0005`–`0007` — including the privilege lockdown. Every block downgrades a privilege error to a warning, which makes SETUP.md §2's verification queries mandatory. Its `storage.objects` policies are currently dead code (all Storage access is service-role); the Realtime publication is not.

## Design system

Print-first, translated in `src/app/globals.css`. `--text-*`, `--radius-*` and `--font-*` are reset to `initial`, so `text-sm` / `rounded-lg` / `font-sans` **do not exist** — that is deliberate enforcement, not an oversight.

- **Red is rationed: one red run per view** (the single primary action) plus chrome. `PageHeader`'s `action` is one slot, structurally.
- **Locked Tier 3 pairs** are only reachable through `tone-ok` / `tone-err` / … utilities, which set background and text together. `status-chip.tsx` is the only place a status picks a tone; `tone-warn` is deliberately unallocated so "documents failed" still means something.
- **No shadows, ever.** `focus:ring-*` compiles to `box-shadow` and is banned; focus is an `outline`.
- **`rounded-box` (2px) everywhere.** No pills.
- **Summary ordinals are `n400`, not red** — a rationed colour cannot be applied to an unbounded, model-generated list.
- **Fonts:** Bernabeu is commercial and absent; `src/lib/fonts.ts` substitutes Archivo behind a one-export swap seam (`next/font/local` throws at build on a missing file, so the seam must be a module boundary). Anton is loaded solely for `/login`, the app's one "cover".
- **Light only.** The Tier 3 pairs have no dark half, and inventing eight hexes would violate "locked upstream".

Review greps: `shadow-|ring-|box-shadow` → 0; `rounded-` other than `rounded-box` → 0; Tier 3 hexes outside `globals.css` → 0.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
