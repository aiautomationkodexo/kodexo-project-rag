# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An internal portfolio knowledge base: projects are described or documented, the text is chunked and embedded, an LLM maintains an additive open-section summary, and projects are found by hybrid (vector + full-text) search.

- **[PRD.md](PRD.md)** — the implementation spec. Still the source of truth for *intent* and for the §15 invariants. Its *mechanics* are Next 15-era; see Deviations below.
- **[DESIGN.md](DESIGN.md)** — Kodexo Labs design system. Print-first (A4, `pt`); §9 is the web translation.
- **[SETUP.md](SETUP.md)** — everything the code cannot do for itself (Supabase dashboard, Vercel, local stack).

Built through PRD §14 **T1–T8**, plus a security migration (`0007`), the §10 completion email, and the §14 additive-summary regression test. Migrations `0009`–`0011` complete T7/T8: sweep recovery + storage lifecycle, the 200 MB media cap, and tag approve/merge.

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

npm test            # fast suite: pure logic, no network, no database
npm run test:llm    # PRD §14 additive-summary regression — CALLS THE LIVE OpenAI API
```

`npm test` runs `node --test` with two flags that are both load-bearing:
`--conditions=react-server` resolves `server-only` to its own no-op (otherwise
every pipeline/ai import throws), and `--import ./tests/setup.mts` installs a
resolver hook for `@/*` aliases and extensionless relative imports, neither of
which Node does natively. Without them a test can only reach leaf modules.

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

**Every signed-in page lives in the `src/app/(app)/` route group**, whose
`layout.tsx` renders the shell. A route group adds no URL segment, so
`/projects` is still `/projects`. `/login`, `/api`, `/auth`, `error.tsx` and
`not-found.tsx` sit OUTSIDE it — the first is the app's full-bleed cover, and
the rest must render without a rail (and without the `getCurrentUser()` the
rail needs). Pages no longer import `AppShell` themselves; doing so nests two
shells. No auth check belongs in that layout: layouts do not re-run on every
navigation, so a guard there would not be re-evaluated — each page calls
`requireClaim` itself.

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

**Claims only (§15.1), now with a resource dimension.** Since `0018` access is "global claim OR per-project grant" — see the scoped-access section below. `can()`/`has_claim()` are unchanged; `canOn()` is the scoped sibling.

**Claims only (§15.1).** `has_claim()` in SQL, `can(user, claim)` in TS. `is_super_admin` is the single flag and short-circuits to true — so **a super admin correctly has ZERO rows in `user_claims`** and still passes every claim check. Empty is not missing privileges; `grant_default_claims` skips super admins deliberately. There is no role string anywhere; do not introduce one.

**Search.** One RPC, `search_projects`: pgvector + Postgres FTS fused by RRF (`1/(60+rank)`). Filters are pre-filters inside the SQL. Scoring is **max-pooled** per project (`DISTINCT ON`) — summing would favour long documents; do not "fix" it. `min_similarity` defaults to 0.30, not the PRD's 0.15, or the floor admits everything and §15.5 is unenforceable. PostgREST cannot express vector operators, so similarity queries *must* go through `.rpc()`. Embeddings go through `toVector()` in [src/lib/supabase/vector.ts](src/lib/supabase/vector.ts): the type generator emits `vector` as `string`, and **both** a JSON array and a JSON string were verified to work against a real PostgREST — the widely-repeated "never `JSON.stringify` an embedding" warning does not apply here.

**Summaries are open-section.** `summary` is an ordered array of `{key,label,content}`. What makes regeneration non-destructive is prompt rule 1 (reuse keys exactly) — it is load-bearing. `summary_text` is the flattened form for embedding and is never a substitute for iterating the array.

## Uploads and extraction (T6)

Files go **straight to Storage** from the browser via a signed URL, keeping payloads (50 MB documents, 200 MB media) away from Vercel's 4.5 MB body limit. `/api/upload-url` mints both the document id and (on create) the project id, so the storage key and the row agree with no second round trip and no staging bucket.

- **`/api/upload-url` is the only cookie-authenticated route under `/api`.** It authenticates itself with `getCurrentUser()`. Do not add `/api` back to the proxy matcher to "fix" it — that 307s the machine routes.
- **Upload progress needs `XMLHttpRequest`.** `uploadToSignedUrl` builds a FormData and PUTs it with `fetch`, which reports no progress; `src/lib/uploads/upload.ts` sends the byte-identical request over XHR.
- **Re-wrap the File with the canonical MIME before sending.** Browsers report `""` for `.md`/`.txt`, which becomes `application/octet-stream`, and the bucket's `allowed_mime_types` rejects it.
- **PPTX slides sort numerically.** Lexicographic gives `slide1, slide10, slide2` and scrambles a deck without ever throwing — the text is all present, so it survives a glance in QA and only surfaces as incoherent summaries.
- **Permanent vs transient failures.** `PermanentExtractionError` (no text layer, not a real pptx, unsupported type) marks a document `failed` immediately. Retrying a malformed file three times can never succeed and holds the whole project in `processing` for ~15 minutes.
- **Duplicate extracted text** hits `documents_project_hash_idx` (23505). Handled as a *semantic* outcome — chunks deleted, document `failed` with a naming message, `attempts` maxed. Letting it reach the generic retry path stranded the project permanently with no visible error.
- **`addFilesToProject` sets `projects.status = 'processing'` BEFORE dispatching.** `claim_finalize` only fires on `processing`; adding files to a `ready` project without the reset means it returns false forever and no re-summary happens.

## Transcription, tags, and the sweep (T7 / T8)

**Three numbers must move together, or documents get processed twice.**
`TRANSCRIBE_TIMEOUT_MS (600s) < maxDuration (800s) < claim_document reclaim (900s)`.
The middle inequality is the only thing preventing a second worker from
starting on a document the first is still transcribing; the two would then race
`delete chunks` against their own inserts and leave a duplicated chunk set that
is invisible except as double-weighted retrieval. `chunks_document_ordinal_idx`
(`0009`) turns that into a loud 23505, but it is a backstop, not a licence.
The first inequality exists because Vercel's kill at `maxDuration` is
*uncatchable* — no catch runs, so a hung call leaves no status, no error and no
attempt bookkeeping.

**Deepgram failures classify on "is the file the problem", not "could this ever
succeed".** A permanent verdict is terminal and writes a message onto the
user's document. So a wrong `DEEPGRAM_API_KEY` is **transient** — matching the
*missing*-key path, which is transient because `required()` throws a plain
Error — and only an undecodable-media 400, a 413, or a successful decode with
no speech are permanent. The one 400 that is transient is Deepgram failing to
*fetch* our signed URL; classifying it permanent fails a good recording forever.

**`SIGNED_URL_TTL_SECONDS` is derived from `TRANSCRIBE_TIMEOUT_MS`, not typed.**
If the URL expires mid-transcription Deepgram reports a 400, which is one
string match from being read as corrupt media.

**The per-type size rule lives only in `src/lib/uploads/mime.ts`.** The bucket's
`file_size_limit` is a single scalar and cannot express it, and the
`documents.size_bytes` CHECK is a flat 200 MB *bound* on a client-reported
number. `classifyFile` is the only gate that runs before the bytes move.
`supabase/config.toml` must stay in step or `npm run buckets:push` writes 50 MiB
back over migration `0010`.

**`merge_tech_tag` takes `FOR UPDATE`, and the mode is the point.** Inserting
into `project_tech_tags` runs an FK check that takes `FOR KEY SHARE`, and
`FOR UPDATE` is the only mode that conflicts with it. `FOR NO KEY UPDATE` reads
as sufficient and leaves the race open: a concurrent finalize inserts
`(P, source)` after the repoint and before the delete, the cascade eats it, and
project P ends up carrying **neither** tag. The merge also moves every
referencing row *by name* before deleting the tag — its correctness never
depends on `ON DELETE CASCADE`.

**Tag writes go through the USER's client.** `tags_write` is the authorization
check, and `0011`'s `grant update (is_approved)` is what stops the approve call
from also rewriting `canonical_name`. `DELETE` on `tech_tags` is revoked from
`authenticated` outright — a raw delete cascades the tag off every project with
no repointing, which is exactly what merge exists to prevent.

**Alias upserts must pass `ignoreDuplicates: true`.** PostgREST's default
`onConflict` is `DO UPDATE`, which *steals* the alias from whatever tag owns it
— the mechanism that manufactures orphaned duplicate tags, and the one thing
that can silently undo a committed merge.

**PRD §13 step 3 does not do what the PRD says.** "Objects with no `documents`
row" never matches a deleted project, because `soft_delete_project` only sets
`deleted_at` and nothing hard-deletes a project. The sweep therefore has two
storage rules: purge by `projects.deleted_at` past 30 days (the actual leak),
and remove abandoned uploads. The latter **needs the 30-minute age guard** —
`/api/upload-url` mints the key before the `documents` row exists, so every
in-flight upload is by definition an object with no row.

**`writeAudit` never throws.** Every call site runs after its mutation has
committed, so throwing would report failure for work that succeeded — and in
`deleteProject`/`softDeleteUser` would show an error for a row that is already
gone. `merge_tech_tag` writes its own audit row in SQL instead, which is atomic
with the merge; that is only possible because the work is already in an RPC.

## Fields, disclosure, client info, links, visibility (0012–0016)

**`disclosure()` in [src/lib/projects/disclosure.ts](src/lib/projects/disclosure.ts) is the only interpreter of `nda_status`.** It fails closed: NULL, `Select`, `Needs Review` and any unrecognised value all resolve to `{mayUseBrand: false, mayUseClientName: false}`. A project with no NDA answer behaves exactly like `Permanently Excluded`. Nobody switches on the status string anywhere else — a second interpretation site is how the summariser and a future MCP layer come to disagree about whether a client may be named.

**`nda_status` is not writable through the API at all.** `0013` revokes the table-level UPDATE grant on `projects` and re-grants every column *except* it, so a `PATCH` carrying `nda_status` gets 42501; the only write path is `set_nda_status()`. An `assertClaim` alone would have been decoration — `projects_update` checks the *claim*, not the *column*, which is structurally the escalation `0007` closed for `profiles.is_super_admin`. **Consequence: any column a later migration adds to `projects` is un-updatable until it is added to `0013`'s re-grant list.** That is `0007`'s fail-closed property, and SETUP.md §2.1 has a query that finds the omission.

**The client-name suppression in the summariser is CONDITIONAL, and it must stay that way.** `SUMMARY_SYSTEM` rule 6 mandates reproducing testimonials verbatim *"with attribution when known"* — and attribution is naming. A blanket "never name the client" rule contradicts a load-bearing rule that `test:llm` asserts, and contradictory instructions on the same string produce unpredictable *partial* redaction, which is worse than none because it looks like a guarantee. `CLIENT_ANONYMITY_RULE` is appended only when `disclosure().mayUseClientName` is false, and it resolves the conflict explicitly: quote bodies stay verbatim, attribution moves to role. `generateSummary`'s flag **defaults to false** so a caller that forgets it gets the anonymised prompt.

**It is a mitigation, not a control.** The model still receives the client's name in the corpus, because `raw_text` genuinely contains it. The structural guarantee is that `project_client` is never read in the pipeline at all.

**`project_client` is a separate table because RLS is row-level and cannot hide one column.** Never join it into anything in `src/lib/pipeline/*` — the admin client is in use there, so RLS gives **zero** protection and the absence of the join is the whole enforcement. **Honest limitation, do not overstate it:** `documents.raw_text` still contains client names, therefore so do `chunks.text` and the embeddings, so `search_projects` can return a snippet naming the client to any `projects:view` holder. What holds is *"the structured field is not retrievable; the prose may still mention the client."* Never call it confidentiality.

**`no_index` needs TWO enforcement points and the chunk skip is not sufficient.** A `no_index` document still reaches `status='done'` with `raw_text` populated (§15.2 requires that), so without the `.neq("visibility", "no_index")` filter on `finalizeProject`'s corpus query its text is still summarised into `summary_text` — **which is embedded**. Skipping `chunkText`/`embedBatch` in `processDocument` closes the chunk route and leaves the summary route wide open.

**The `no_index` skip in `processDocument` must still mark the document `done` and still reach `maybeFinalize`.** `claim_finalize` counts `queued`/`processing` as pending, so any non-terminal status there holds the project in `processing` forever — no summary, nothing logged. It must also *delete* existing chunks, not merely skip inserting them.

**`documents.visibility` is two values, not four.** `internal`/`public`/`on_request` were specified for an MCP layer that does not exist; storing them would render a control in a `<select>` that implies an effect it does not have. Adding them later is a drop-and-add of a named CHECK.

**Links are never fetched server-side.** A user-supplied URL fetched by our server reaches cloud metadata endpoints and every RFC1918 address the runtime can route to, and a blocklist does not work (DNS rebinding, redirect chains, IPv6-mapped and decimal IP encodings). This is also why titles are **not** AI-filled: with no fetch the model has only the URL string, and for an opaque URL it produces a confabulated title that becomes the link's *only* searchable text. `parseLinks` allowlists `http`/`https` — React escapes text but does **not** sanitise `href`, so a stored `javascript:` URL is stored XSS.

**Both new vocabularies have SQL↔TS drift tests** (`tests/disclosure.test.mts`, `tests/validate.test.mts`), following `alias-key.test.mts`. The em dashes in `nda_status` are U+2014 and load-bearing: a hyphen in either copy means the form offers a value the CHECK rejects, surfacing as an opaque 23514 nowhere near the cause.

## Scoped per-project access (0017 / 0018)

**Access is now "global claim OR grant row" — two paths, and that is the maximum.** `project_grants (project_id, user_id, claim)` is the resource dimension `user_claims` never had. Do **not** add a third path; in particular do not add implicit ownership access (`created_by = auth.uid()` silently conferring rights) even though the column exists and it looks free. Three paths to one permission is unauditable, and an ownership rule would retroactively widen access for every project already in the database. If ownership should confer access, write a real grant row at create time.

**`in (select ...)`, never `exists (...)`. This is the one rule that matters most, and its failure mode is silent.** Every scoped policy arm is `<col> in (select project_id from project_grants where user_id = (select auth.uid()) and claim = '<c>')`. An `EXISTS` body referencing the outer row is *correlated*, and inside a security qual Postgres frequently declines to pull it up into a semi-join — it degrades to a per-row `SubPlan` and abandons the index while **returning identical results, roughly a thousand times slower**. `tests/scoped-claims.test.mts` asserts the shape against the migration text; it has been verified to fail when one policy is rewritten as `EXISTS`. SETUP.md §2.2 has the `EXPLAIN` signatures.

**Do not factor the subquery into a helper.** A set-returning `granted_projects(uid, claim)` reads better and is wrong: the planner cannot see inside it to use `project_grants_user_claim_idx`, nor hash the result the way it hashes an inlined `in (select ...)`. The repetition across 17 arms is the price of the index.

**Two policies, not one with an OR.** A row-*independent* expression wrapped as `(select has_claim(...))` is hoisted into an InitPlan evaluated once per statement; a scoped check references the candidate row and therefore *cannot* be hoisted — that is structural. Splitting keeps global-claim holders on the hoisted path and confines the join to users who actually hold grants. Postgres OR's permissive policies for free. Policies are named in `_global`/`_scoped` pairs so a grep finds them; `projects_insert` is deliberately unpaired (a row that does not exist cannot be in a grant set), and `projects_delete`/`documents_delete` are global-only.

**Grants are purely additive and there is NO deny primitive.** Adding a row can never remove access, which is what makes the rollout risk-free and makes "what can this user reach?" a plain union. **Never add a restrictive policy for scoping** — it forfeits that guarantee. The cost is that "everything except project X" is inexpressible; that is the right trade.

**Grants carry `projects:view` and `projects:update` only** (`project_grants_claim_check`, mirrored by `SCOPED_CLAIMS`). `projects:create` is unscopeable in principle — a grant names an existing project. `projects:delete` is excluded by decision, which is why `soft_delete_project`'s bare global check remains correct. **If `projects:delete` is ever added to that CHECK, `soft_delete_project` must gain the scoped arm in the same migration** — a definer function that escapes a policy must re-apply it, and RLS will not save you inside one. `projects:view-client-info` and `projects:set-nda` are portfolio-level trust decisions and are deliberately not grantable.

**Every scoped arm outside `has_claim` must call `is_active_user` by hand.** `has_claim` folds in the activity check and short-circuits on `is_super_admin`; the scoped arms in `search_projects` and `may_grant_on_project` never call it, so without the explicit line a *deactivated or soft-deleted* user holding a grant row would still pass. The `profiles` FK is `ON DELETE CASCADE`, which only fires on a hard delete, and this system soft-deletes users. These are the first authorization tests in the schema that do not route through `has_claim`.

**`search_projects` discharged 0005's standing invariant, and BOTH halves were required.** It is `SECURITY DEFINER`, so none of the new policies apply inside it. The entry guard had to relax (a grants-only user was rejected before the CTE ran) *and* the `eligible` CTE had to be scoped (or every scoped user gets the whole portfolio). Doing only one is worse than doing neither, in opposite directions. `ef_search` is raised for grants-only users because 0005's documented recall concern becomes acute when `eligible` selects a fraction of a percent of rows — the HNSW top-60 would otherwise often contain none of their chunks and search would return empty for a user whose projects match well.

**`requireClaim("projects:view")` is REMOVED from the project detail page, not scoped.** It *redirects* on a missing global claim, so a grants-only user was bounced off a project they can legitimately see before RLS was ever consulted. `getProject` returns null and `notFound()` is the correct answer; a claim check in front of RLS there is a bug, not defence in depth. List pages use `requireProjectAccess()` ("has any project access") instead — the gate stays, because an empty list is worse than a redirect.

**`canOn` / `assertCanOn` are siblings of `can` / `assertClaim`, never replacements.** `assertClaim` is a synchronous `asserts user is CurrentUser` predicate and TypeScript forbids `asserts` on an async function, so the scoped versions cannot be overloads. `canOn` returns true whenever `can` does — the code-level statement of "a flat claim is an implicit global scope", and what makes super admins work with zero rows in either claim table. **The fast path is the point:** when `can()` is true it returns without touching the database, so global holders pay nothing.

**`grantsFor` filters `user_id` explicitly, and that is not redundant.** `grants_select_self` would scope the read, but a `users:view` holder also matches `grants_select_admin` and the two are OR'd — such a user would read everyone's grants and compute a wrong answer for themselves.

**Grant writes go through the USER's client, never the admin client.** The per-row arms of `grants_insert` — `has_claim(uid, claim)` ("cannot grant what you don't hold") and `may_grant_on_project(uid, project_id)` ("cannot grant on a project you cannot see") — exist *only* in the policy. Those arms must **not** be wrapped in a scalar subquery: hoisting would evaluate them once against an arbitrary row and defeat the guard. `may_grant_on_project` is deliberately **not transitive** — being a grantee does not make you a granter, or "who can reach project P?" stops being a lookup and becomes a graph traversal.

**Revocation is deliberately laxer than granting.** `grants_delete` omits `may_grant_on_project` because that check tests `deleted_at`: requiring it would make a grant on a soft-deleted project unremovable, and an admin whose own visibility narrows would lose the ability to clean up grants they made. Since there is no deny primitive, removing a row can only ever *reduce* access.

**Grant a BUNDLE, never a bare `projects:update`.** A row granting update without a matching view row produces a user whose UPDATE passes `projects_update_scoped` and then fails the post-image SELECT check with an opaque RLS error (0006's mechanism). No table constraint can express that cross-row invariant, so `GRANT_PRESETS` is what prevents it — and a test asserts every bundle includes `projects:view`.

**`grant_default_claims` is unchanged by choice:** every new non-super-admin still gets a global `projects:view`, so nothing breaks on rollout and a restricted user is made by revoking it and adding grants. Record per user whether global is *"right"* or merely *"never narrowed"* — the second is drift.

**Statistics counted through the user's client need no `project_id` filter.** `getPortfolioStats`' failed-documents count and the `MAX_FILES_PER_PROJECT` count are already confined by `documents_select_*`. Adding an explicit filter would be a second copy of the rule, free to drift from the policy. The exception is anything on the **admin** client: `notifyProjectReady` checks scope by hand, because RLS gives it nothing.

**`tags:manage` remains portfolio-wide tag authority, and that is intended.** `merge_tech_tag` and `unapproved_tag_usage` are `security definer` specifically so a tags curator need not hold `projects:update`; merging a tag necessarily affects every project using it, so a per-project tag curator is incoherent. Do not scope them.

## Constraints that bite silently

- **§15.12 lives in `src/app/projects/[id]/summary-sections.tsx`** — the only component touching `summary.sections`. No `switch`, no `if`, no lookup keyed on `s.key`; array order unconditionally; a `.sort()` is a bug.
- **Never `.sort()` in the search render path.** `queries.ts` returns RRF order; re-sorting destroys the ranking.
- **Never render the search `score`** — an RRF sum in the 0.008–0.033 range. Any percentage or bar fabricates calibration.
- **No highlighting on snippets.** A top result can share zero words with the query (that *is* T4's acceptance criterion), so highlighting would misrepresent the ranking.
- **§15.10** — `src/lib/projects/queries.ts` uses explicit column lists. `select("*")` is banned there. **A new project column must be added to `getProject`'s select or it arrives `undefined` and renders as "—" — a silent wrong answer, not an error.** Four selects gate the new fields: `getProject` and `LIST_COLUMNS` in queries.ts, `processDocument`'s document select, and `finalizeProject`'s project select. Supabase's typed client turns a *missing* column into a compile error, which is what makes this survivable; a column merely absent from a list does not fail.
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

**The source of truth is Kodexo Labs Visual Identity v1.0** (`tokens.css`, generated from `sot/visual-identity.tokens.json`, marked *"DO NOT modify locally"*). `src/app/globals.css` transcribes it. **[DESIGN.md](DESIGN.md) is the older print-first derivation and is superseded wherever the two disagree** — it remains useful for component anatomy (§5) and page architecture (§6), not for tokens.

What v1.0 changed, and what it did not:

| | DESIGN.md (was) | Identity v1.0 (now) |
|---|---|---|
| Radius | flat 2px, "no pills" | `sm 6` / `md 10` / `lg 14` / `xl 20` / `pill`. `--radius-box` is an alias for `sm` and stays the default |
| Elevation | principle 6, banned | `--shadow-sm/md/lg`, exposed as `elev-sm/md/lg` |
| H1 | Bernabeu | **Unbounded 900** (statement), set on `h1` globally |
| H2–H4 | Bernabeu → Archivo | Bernabeu → **Outfit** — the SOT names its own fallback, so the substitute is specified rather than improvised |
| Kicker | Manrope uppercase | `.mono-kicker` → the `kicker` utility (JetBrains Mono, 12px, .12em) |
| Semantic | bg + text pair | bg + **border** + text triple; `tone-*` sets all three |
| Spacing | pt conversions (11/15/17/35px) | 4px grid; the named roles resolve onto it |

Unchanged: red is rationed to one run per view, all chrome comes from the neutral ramp, semantic values are used as locked sets, and colours are never hand-picked.

**Light-only is now a scoping decision, not a limitation.** v1.0 *does* define `[data-theme="dark"]`; this app declines it for now and says so in `globals.css`. Turning it on is: copy that block into `:root[data-theme="dark"]`, add a toggle. No call site changes — every colour is already a token.

`--text-*` and `--font-*` are still reset to `initial`, so `text-sm` / `font-sans` **do not exist**. `--radius-*` is now populated from the SOT rather than deleted, so `rounded-sm/md/lg/xl/pill` resolve to *our* scale — but `rounded-full`, `rounded-none` and Tailwind's own numeric steps still do not exist.

**Elevation is rationed like red.** `elev-sm` on cards and stat tiles; `elev-md` only for a surface floating alone on an empty page (`/login`, `error`, `not-found`). Toolbars, table rows and skeletons get none — a control surface is not a raised one. A hand-written `box-shadow` value remains a review failure; the three tokens are the only legal elevations.

- **Red is rationed: one red run per view** (the single primary action) plus chrome. `PageHeader`'s `action` is one slot, structurally.
- **Locked semantic sets** are only reachable through `tone-ok` / `tone-err` / … utilities, which set background, border and text together. `status-chip.tsx` is the only place a status picks a tone; `tone-warn` is deliberately unallocated so "documents failed" still means something.
- **Focus is an `outline`, never a `ring`.** Elevation is legal now, but `focus:ring-*` compiles to `box-shadow` and would overwrite the `elev-*` of any card a focused control sits inside — one property, two owners.
- **`rounded-box` (= `sm`, 6px) is the default.** Reach past it only for the SOT's named cases: `md` for modals/popovers, `pill` for chips and avatars.
- **Summary ordinals are `n400`, not red** — a rationed colour cannot be applied to an unbounded, model-generated list.
- **Fonts:** five roles in `src/lib/fonts.ts` — statement (Unbounded 900, `h1` only), heading (Bernabeu → **Outfit**), body (Manrope), hyper (Anton), mono (JetBrains Mono, also the `kicker` utility). Bernabeu is commercial and absent; Outfit is the SOT's *own* named fallback, sitting behind a one-export swap seam (`next/font/local` throws at build on a missing file, so the seam must be a module boundary). Anton is loaded solely for `/login`, the app's one "cover" — if that composition goes, delete the family. `font-display` survives only as an alias for `font-heading`; new code says `font-heading`.
- **Light only — by choice.** Identity v1.0 *does* define a dark theme; shipping the variables with no control to flip them would be dead CSS, and shipping them on `prefers-color-scheme` would hand every user an unreviewed theme. See the note in `globals.css`.

Review greps: `box-shadow` outside a `var(--shadow-*)` → 0; `class="…shadow-|ring-…"` → 0; radius classes outside the SOT scale (`rounded-box|sm|md|lg|xl|pill`) → 0; semantic hexes outside `globals.css` → 0.

**Tailwind v4 extracts class-name candidates from comments too.** Writing the
bare word *shadow* or *ring* in prose — even in the comment that documents the
ban — emits a real `.shadow{}` / `.ring{}` utility into the bundle. Backtick
them. (Both also appear in a stock v4 build regardless of source, so the greps
above are over `src/`, not over the compiled CSS.)

### The dashboard shell (added after T8)

The print system's A4 running head became a 240px rail (`--spacing-rail`), and
the A4 text block (`--container-doc`, 880px) is no longer the app measure —
`--container-app` (1400px) is. `--container-doc` and `--container-prose` remain
correct for READING surfaces: the login cover, and the summary column on a
project page.

- **The rail is `fixed` with a matching `md:pl-rail` on the content.** As a
  flex sibling it scrolls away with a long table, which defeats persistent nav
  on exactly the pages that need it.
- **Active nav is n100 + a 2px red edge, never a red fill.** The fill is the
  reference dashboards' idiom and it spends the view's red ration on chrome.
- **Stat tiles are neutral.** The references tint each tile a different hue;
  Tier 4 is "one hue per document" and Tier 3 pairs are reserved for real
  states, so a five-colour tile row would spend the whole semantic palette on
  decoration. Hierarchy is typographic — display 900 at `--text-section`.
  `StatCard`'s `tone` tints the VALUE only, for the one tile that reports an
  actual problem.
- **Lists are real `<table>`s** (`src/components/ui/table.tsx`), not stacked
  `<article>`s. **Search results are the exception** and keep the article form:
  a result must show the matched snippet as evidence, which no cell can hold —
  and the no-sort / no-score / no-highlight rules still apply there.
- **Pagination is links, never buttons**, so paging stays bookmarkable and in
  the back-history. Page 1 is the bare URL with no `?page=1`.
- **`listProjects` / `listUsers` clamp an over-range `?page=` themselves** by
  re-querying the last real page. A caller cannot clamp first because the total
  is unknown until the query returns. Filter forms deliberately omit `page`, so
  changing a filter drops the stale offset instead of landing on an empty page.
- **Search cannot paginate.** `search_projects` takes a single `match_limit`
  and returns RRF order; there is no stable offset. `?per=` doubles as "how
  many results to ask for".

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
