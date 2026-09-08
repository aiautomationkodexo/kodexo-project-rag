# Setup

Everything the code cannot do for itself. Work top to bottom.

## 0. Prerequisites

- Node 22+ (this repo is developed on Node 24; the OpenAI SDK requires 22 LTS minimum)
- A Supabase **cloud** project and an OpenAI API key
- A Google account that can issue an **App Password** (see §3)

No Docker. This project is cloud-only: there is no local Supabase stack, and
`db:start` / `db:stop` / `db:reset` no longer exist. There is one database and it
is the real one — which is why `db:push`, `config:push` and `seed:admin` all name
their target before they touch it.

The Supabase CLI is a devDependency, not a global install, so every command below
works from a clean `npm install` with no extra tooling.

```bash
npm install
cp .env.example .env.local
npx supabase login          # or export SUPABASE_ACCESS_TOKEN
```

---

## 1. Cutover runbook

Order matters. `seed:admin` calls `has_claim()`, so it cannot run before the schema
is pushed.

### 1.1 Create the project

Create a **new** project in the Supabase dashboard. Do not reuse an existing one.

- **Postgres 17**, to match `[db] major_version` in `supabase/config.toml`.
- **Asymmetric JWT signing keys** (Settings → API → JWT Keys). `src/lib/supabase/proxy.ts`
  calls `getClaims()`, which verifies locally against a cached JWKS *only* with
  asymmetric keys. On legacy HS256 it silently degrades to a network call on every
  request through the proxy matcher, including prefetches — which defeats the whole
  reason the proxy is designed the way it is.
- A fresh project also ships `vector` *available but not enabled*, which is what
  lets migration `0001` install it into the `extensions` schema. On a reused project
  `vector` may already exist in `public`, and then `create extension if not exists`
  silently no-ops and every `extensions.vector` reference in `0001` and `0005`
  breaks. This is the main reason not to reuse a project.

### 1.2 Fill in `.env.local`

Every key in `.env.example`. `NEXT_PUBLIC_SUPABASE_URL`, the publishable key and the
secret key come from Settings → API.

### 1.3 Point `supabase/config.toml` at production

**Two values must be changed before the first `config:push`** — they are marked with
a box comment in the file:

- `[auth] site_url` — the deployment origin, no trailing slash. It must byte-match
  `NEXT_PUBLIC_SITE_URL`.
- `[auth] additional_redirect_urls` — the production origin with a `/**` glob.

Pushing the shipped `127.0.0.1` values would set *production's* Site URL to
localhost, and because Supabase silently substitutes Site URL for any redirect that
is not allow-listed, every magic link would then point at localhost with no error
anywhere.

### 1.4 Two ways to apply the schema

**A — `supabase/setup.sql` (portable, no CLI, no DB password).** One file, run in
Dashboard → SQL Editor. Use it when standing up a brand-new project or **moving to
a different Supabase account**. It contains all seven migrations plus the super
admin, and the SQL editor runs as `postgres`, which is the privilege level the
storage and publication statements want.

It is **generated** — `npm run build:sql` concatenates `supabase/migrations/*.sql`
then `supabase/seed/*.sql`. Never edit `setup.sql` by hand; edit the migration and
regenerate, or the next build silently discards your change. The generator refuses
to write if either directory is empty, so a truncated file cannot be produced by
accident.

It is for a **fresh, empty project**. Re-running it against a populated database
stops at the first `create table` with "relation already exists" and changes
nothing — a safety feature, not a limitation. To re-assert only the super admin, or
to point it at a different person, run `supabase/seed/0100_super_admin.sql` on its
own; that file *is* idempotent and its two editable values are at the top.

**B — the CLI (normal path for an already-linked project).**

### 1.5 Link and push

```bash
npm run db:link                 # writes supabase/.temp/project-ref
npm run db:diff                 # dry run — read what it intends to apply
npm run db:status               # confirm the 0001..0007 names parse
npm run db:push                 # prints the target ref first
```

**Watch for `WARNING: 0004: …` lines.** Migration `0004` fails *soft* by design:
`db push` stops at the first error, so an unguarded failure there would leave `0005`
(search), `0006` (soft delete) and `0007` (the privilege lockdown) unapplied — and an
unapplied `0007` means the profiles privilege-escalation hole is live. Each block in
`0004` therefore downgrades a privilege error to a warning. **That makes the
verification in §2 mandatory, not optional.**

```bash
npm run config:push             # auth settings, SMTP, redirect list, magic-link template
npm run buckets:push            # only if §2 shows the bucket missing
npm run types:db
npm run seed:admin -- <project-ref>
npm run seed:admin -- <project-ref>    # twice: idempotency is PRD §14 T2
```

`config:push` and `buckets:push` deliberately shell the CLI through
`node --env-file-if-exists=.env.local`, because `env(SMTP_PASSWORD)` in
`config.toml` is resolved from the **process** environment at push time. Running the
bare CLI instead would write an *empty* SMTP password to the project.

`seed:admin` refuses to run unless you name the project ref, and prints the target
first. It is also the **break-glass path**: `0007` makes `is_super_admin` unwritable
through the API, and `getCurrentUser()` signs out a super admin who deactivates
themselves — if that happens, this script is the only way back in. That is why its
upsert force-resets `is_active` / `deleted_at` / `is_super_admin`.

---

## 2. Verify the push

Run these in the dashboard SQL editor. Do **not** infer success from the exit code —
`0004` is designed to succeed with work skipped.

```sql
-- all ELEVEN recorded: 0001..0011
select version from supabase_migrations.schema_migrations order by version;

-- vector must be in `extensions`, not `public`
select e.extname, n.nspname from pg_extension e
join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector';

-- 0005 landed with the right signature
select p.oid::regprocedure from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'search_projects';

-- 0002: RLS actually on (the PRD shipped this off)
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;

-- 0004a + 0010: bucket. Expect: false | 209715200 | 11
select public, file_size_limit, array_length(allowed_mime_types, 1)
from storage.buckets where id = 'project-files';

-- 0004b: storage policies. Absence is TOLERABLE — see below.
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects';

-- 0004c: realtime. Absence is NOT tolerable.
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' order by 1;

-- 0007: expect EXACTLY name, is_active, deleted_at
select column_name from information_schema.column_privileges
where table_schema='public' and table_name='profiles'
  and grantee='authenticated' and privilege_type='UPDATE' order by 1;

-- 0009: the sweep RPCs + the chunk uniqueness backstop
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and proname in ('stranded_projects','purgeable_projects','recently_active_projects')
order by 1;
select indexname from pg_indexes
where tablename='chunks' and indexname='chunks_document_ordinal_idx';

-- 0010: expect 209715200 (a 50 MB value means the migration did not land)
select pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.documents'::regclass and conname='documents_size_bytes_check';

-- 0011: the alias rule must agree with src/lib/tags/alias-key.ts.
-- Expect: nextjs | c | net
select tech_tag_alias_key('Next.js'), tech_tag_alias_key('C#'), tech_tag_alias_key('.NET');

-- 0011: tags_write must now be claim-based, NOT is_super_admin
select policyname, qual from pg_policies
where schemaname='public' and tablename='tech_tags' and policyname='tags_write';

-- 0011: expect EXACTLY is_approved (a row for canonical_name means the
-- lockdown did not apply and a curator can rename tags out from under aliases)
select column_name from information_schema.column_privileges
where table_schema='public' and table_name='tech_tags'
  and grantee='authenticated' and privilege_type='UPDATE' order by 1;
```

**Aliases that predate `0011`.** Its CHECK is added `NOT VALID`, so existing rows are
not scanned and the push cannot fail on one. Audit and finish the job separately:

```sql
select alias, tech_tag_id from tech_tag_aliases
 where alias <> tech_tag_alias_key(alias);          -- expect zero rows
alter table tech_tag_aliases validate constraint tech_tag_aliases_normalized;
```

**Why the storage policies are tolerable and Realtime is not.** Every Storage call in
this app runs through the service-role client and bypasses RLS —
`/api/upload-url` mints a signed upload URL (that URL's own token is the browser's
authorisation) and `lib/pipeline/extract.ts` downloads as admin. Nothing touches
`storage.objects` as `authenticated`, so those three policies are defence-in-depth
for a user-scoped path that does not exist yet. Realtime is the opposite: without the
publication, the live status panel on `/projects/[id]` silently never updates.

If `0007`'s query returns `is_super_admin`, **stop** — the privilege escalation is
live. Re-run `0007` from the SQL editor.

Then check the dashboard reflects `config:push`: Site URL byte-matches
`NEXT_PUBLIC_SITE_URL`; sign-ups disabled; OTP expiry 900; Email Templates → Magic
Link shows the `token_hash` markup; and **SMTP shows a real username and a non-empty
password** — if the username reads literally `env(SMTP_USER)`, the CLI did not
substitute it and those fields must be set in the dashboard by hand.

### 2.1 Verify `0012`–`0016` (fields, NDA, client info, links, visibility)

These five migrations are additive, but three of them change an access posture
and one replaces `search_projects`. `npm test` covers the pure logic (65 tests,
including the SQL-vs-TS drift checks for both new vocabularies); everything
below needs the live database.

**The column lockdown is the highest-risk item here.** `0013` revokes the
table-level UPDATE grant on `projects` and re-grants every column *except*
`nda_status`. A column missing from that re-grant list is a silent inability to
save that field, surfacing as a 42501 only when someone edits it.

```sql
-- 1. Every new column exists, with the right nullability and defaults.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('engagement_type','start_date','end_date',
                      'team_size','nda_status')
order by column_name;
-- All five nullable, no defaults.

select column_name, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='documents'
  and column_name='visibility';
-- NOT NULL, default 'indexed'. Nullable here would make
-- `visibility <> 'no_index'` drop every pre-existing row from search.

-- 2. THE GRANT LIST. Compare against the columns that actually exist —
--    this returns anything writable in the app but NOT re-granted by 0013.
select c.column_name
from information_schema.columns c
where c.table_schema='public' and c.table_name='projects'
  and c.column_name not in ('id','created_by','created_at','updated_at','nda_status')
  and not exists (
    select 1 from information_schema.column_privileges p
     where p.table_schema='public' and p.table_name='projects'
       and p.grantee='authenticated' and p.privilege_type='UPDATE'
       and p.column_name = c.column_name);
-- MUST be empty. A row here is a column nobody can save.

-- And nda_status must NOT be writable directly:
select count(*) from information_schema.column_privileges
where table_schema='public' and table_name='projects'
  and grantee='authenticated' and privilege_type='UPDATE'
  and column_name='nda_status';
-- Expect 0. If it is 1, the definer RPC is decoration and any
-- projects:update holder can PATCH disclosure terms.

-- 3. The em dash round-trips. U+2014, not a hyphen — a mismatch between the
--    CHECK and src/lib/projects/disclosure.ts means the form offers a value
--    the database rejects. tests/disclosure.test.mts asserts the TS side.
select octet_length('NDA Hold — Nothing Can Be Used') as bytes,
       length('NDA Hold — Nothing Can Be Used')       as chars;
-- bytes MUST exceed chars (32 vs 30). Equal means the dash was normalised.

-- 4. RLS is enabled on both new tables. A table created without it is
--    readable by every signed-in user regardless of policies (see 0002).
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename in ('project_client','project_links');
-- Both true.

-- Both need a SELECT *and* a write policy; select-only makes the table
-- permanently unwritable through the API.
select tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename in ('project_client','project_links')
order by tablename, policyname;
-- project_client: _select (SELECT) + _write (ALL)
-- project_links:  links_select (SELECT) + links_write (ALL)

-- 5. search_projects was actually replaced and excludes no_index.
select prosrc like '%visible_docs%' as excludes_no_index
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='search_projects';
-- MUST be true, and BOTH the vec and fts arms must join it — filtering one
-- leaves the document retrievable through the other.
select (select count(*) from regexp_matches(prosrc,'join visible_docs','g')) as joins
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='search_projects';
-- Expect 2.

-- 6. The CHECKs reject what they should. Each of these must raise 23514.
--    Run against a scratch project id.
-- update projects set engagement_type='retainer'  where id='<id>';  -- 23514
-- update projects set team_size=0                 where id='<id>';  -- 23514
-- update projects set start_date='2025-06-01', end_date='2025-01-01'
--                                                where id='<id>';  -- 23514
-- update documents set visibility='public'        where id='<doc>'; -- 23514
--
-- But an end date with no start date is LEGAL (we may know when something
-- shipped and not when it began):
-- update projects set start_date=null, end_date='2025-01-01' where id='<id>';
```

**As a real non-super-admin user** (not `postgres`, which bypasses everything
and is the classic way an RLS check passes while the policy is broken):

- Without `projects:view-client-info`: `select * from project_client` returns
  **zero rows**, not an error. That is what lets `getProject` ask
  unconditionally with no second copy of the rule in TypeScript.
- With the claim: the row is visible.
- Without `projects:set-nda`: `select set_nda_status('<id>','Brand Name Use Only')`
  raises `Missing permission: projects:set-nda`.
- With the claim but a nonexistent or soft-deleted project id: raises
  `Project not found` — the definer function re-proves visibility, because
  RLS does not apply inside it.

**The `no_index` pipeline path**, end to end. All four assertions matter, and
the last is the one that catches a `maybeFinalize` regression:

1. Flip a processed document to `no_index` in the UI.
2. `select raw_text is not null from documents where id='<doc>'` → **true**
   (§15.2 — this is the only thing making the change reversible).
3. `select count(*) from chunks where document_id='<doc>'` → **0**.
4. `select status from projects where id='<id>'` → **`ready`**, not
   `processing`. A document that never reaches a terminal status holds the
   project in `processing` forever, with nothing logged anywhere.
5. Search for a phrase unique to that document → **no hits**.
6. Flip it back, wait for the sweep or re-dispatch: chunks return, and no
   Storage read occurred (use the synthetic description document to prove
   this — its `storage_key` is NULL, so extraction would throw).
7. A project whose **only** document is `no_index` still reaches `ready` —
   this exercises `finalizeProject`'s `usable.length === 0` branch.

---

## 3. Email (Google SMTP + App Password)

**Deviation from PRD §1, which specifies Resend.** Resend cannot deliver to any
address but the account owner's until a sending domain is verified with SPF/DKIM,
and we have no DNS access — on Resend, every user except one would be unable to sign
in. Google delivers to any recipient immediately.

**The app sends its own mail — including magic links.** GoTrue's mailer is rate
limited on two axes (a per-address resend interval and an hourly cap) and both are
low enough to interrupt ordinary use. `src/lib/auth/magic-link.ts` mints the token
with `auth.admin.generateLink()`, which sends nothing and is not rate limited, and
delivers it over the same nodemailer transport as the completion email.

| | Sent by | Configured in |
|---|---|---|
| Magic links | **this app**, via nodemailer | `SMTP_*` / `EMAIL_FROM` |
| "Project is ready" | this app, via nodemailer | `SMTP_*` / `EMAIL_FROM` |
| Recovery / email-change (unused) | GoTrue fallback | `config.toml` `[auth.email.smtp]` |

Two consequences worth knowing:

- **`generateLink` creates the user if the address is unknown** — there is no
  `shouldCreateUser` option. The active-profile lookup at the top of
  `issueMagicLink` is what keeps `/login` from being an open mail relay, and it
  must stay first.
- **We own the resend throttle now.** `RESEND_INTERVAL_MS` (60s) backed by
  `profiles.last_magic_link_at` replaces GoTrue's. Supabase's
  `[auth.rate_limit] email_sent` no longer governs sign-in.

Prerequisites, each of which can block you:

- **2-Step Verification must be on** to create an App Password, and a Google
  Workspace admin can disable App Passwords org-wide. If they are blocked, the
  fallback is Workspace SMTP relay (`smtp-relay.gmail.com`), which needs admin
  configuration.
- **Google rewrites the `From` header** to the authenticated account, so `EMAIL_FROM`
  must be `SMTP_USER` or a verified "Send mail as" alias on it. You cannot send as
  `noreply@kodexolabs.com` without configuring that alias first.
- **This ties sign-in to one mailbox.** The App Password dies when that account's
  password rotates or the person leaves. Prefer a shared/service account.

**Two ceilings, not one.** Google allows ~500 messages/day on a personal account and
~2,000/day on Workspace. Separately, Supabase throttles custom SMTP to 30/hour by
default; `[auth.rate_limit] email_sent` raises that ceiling and is pushed with
`config:push`.

`SMTP_*` unset is a **valid** state: the completion email logs a warning and no-ops,
and the project still finalizes (§15.9). Magic links, however, fall back to
Supabase's built-in sender at ~2/hour, which is unusable.

---

## 4. What is still manual in the dashboard

`npm run config:push` applies almost everything that used to be a click-list here:
sign-ups disabled, 900s OTP expiry, Site URL, the redirect allow-list, the
magic-link template body, SMTP, and the email rate limit. `supabase/config.toml` and
`supabase/templates/magic_link.html` are the source of truth for all of it — they are
production artifacts now, not local-dev files, so a change there is reviewable and
replayable in a way a dashboard click never was.

What genuinely remains manual:

- **Create the project**, pick a region, confirm Postgres 17 and asymmetric JWT keys (§1.1).
- **Storage → Settings**: confirm the *global* file size limit is **≥ 200 MB**. The
  bucket row from `0004`/`0010` sets a per-bucket limit, but the platform limit caps it —
  get this wrong and large uploads fail while the bucket looks perfectly correct, and
  `verify:cloud` passes because it reads the bucket row, not the effective limit.
  200 MB is what T7 needs: audio and video are capped there (documents stay at 50 MB)
  because a 10-minute MP4 routinely exceeds 100 MB. The default global limit is lower
  and may be a plan-tier question.
- **`DEEPGRAM_API_KEY`** in the environment, if audio or video will be uploaded. Every
  other format ignores it; when it is missing, media documents retry and then fail with
  a message that blames the transcription service, and the real cause is only in the
  logs (`[deepgram] 401 …`).
- **Anything §2's verification shows as skipped**, which for `0004` means running the
  affected block from the SQL editor.

**Do not hand-edit the magic-link template.** It must stay:

```html
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">Sign in</a></p>
```

This is not cosmetic. `@supabase/ssr` defaults to PKCE, and PKCE binds its code
verifier to the device that *requested* the link. People request on a laptop and
click in webmail on a phone, and corporate mail scanners pre-fetch URLs — both fail
the default `?code=` exchange with an error that surfaces as "expired link" for a
perfectly valid link. `token_hash` + `verifyOtp` has no device binding. Deleting
`supabase/templates/magic_link.html` makes GoTrue return a 500 on every sign-in,
which `sendMagicLink` logs but cannot surface to the user.

---

## 5. Vercel

- **Plan: Pro is required**, not optional. `vercel.json` schedules the sweep every 5 minutes and Hobby allows only daily crons — the deployment fails otherwise.
- **Enable Fluid Compute.** `maxDuration = 800` on the processing routes only takes effect with it; the platform default is 300s. On by default for new projects.
- **Raise function memory to 4 GB** (default 2 GB) before T6 lands — document extraction peaks at several times the file size.
- Set every variable from `.env.example`. `CRON_SECRET` is provided automatically.
- **`NEXT_PUBLIC_SITE_URL` is inlined at BUILD time**, so it must be set for the
  environment that *builds*, not only the one that runs. Unset, it now throws rather
  than silently defaulting to localhost.
- `INTERNAL_BASE_URL` falls back to `NEXT_PUBLIC_SITE_URL` and then `VERCEL_URL`. Set
  it explicitly if Deployment Protection is on — a self-call to `VERCEL_URL` is then
  answered by a 401 login page instead of the route, and the pipeline would stall
  with every document stuck in `queued`.

---

## 6. Verifying the build

```bash
npm run typecheck    # next typegen && tsc --noEmit
npm run lint
npm run build
```

Acceptance criteria per PRD §14:

| Task | Criterion | How |
|---|---|---|
| T1 | dev serves, typecheck clean | `npm run dev`, `npm run typecheck` |
| T2 | migrations apply; seed idempotent; `has_claim` true | §1.4, then §2's queries |
| T3 | magic link signs in; signed-out redirects; deactivation forces logout | Real inbox; then `update profiles set is_active=false` and navigate |
| T4 | 200+ char description reaches `ready` and is findable by a semantically-related search sharing no exact words | Needs `OPENAI_API_KEY`. The real end-to-end proof — exercises Realtime, the dispatch fan-out, OpenAI and `search_projects` at once |
| T6 | a 5-file project processes in parallel; one corrupt file is `failed` while the rest complete and the project still finalizes | Confirms the bucket, its policies and the platform size limit |

Mail-specific checks:

| What | How | Expect |
|---|---|---|
| Magic link lands correctly | open the link | `/auth/confirm`, **not** `/`. Landing on `/` means the allow-list does not byte-match `NEXT_PUBLIC_SITE_URL` and the `login/page.tsx` safety net is covering for it |
| Not PKCE-bound | open the link on a **different device** | signs in; "expired" means the template did not push |
| Completion email | create a project, wait for `ready` | one email, link resolves to the production origin |
| §15.9 holds without mail | blank `SMTP_PASSWORD`, create a project | still reaches `ready`, one `[email]` warning, **no** `[finalize]` error |
| §15.9 holds on a mail failure | `SMTP_HOST=127.0.0.1 SMTP_PORT=59999`, create a project | still reaches `ready`, `[email] send failed … ECONNREFUSED`, **no** `[finalize]` error |

To test deactivation:

```sql
update profiles set is_active = false where email = 'you@kodexolabs.com';
```
Then navigate anywhere — the next request routes through `/auth/signout?reason=deactivated` and lands on `/login?error=deactivated`.

---

## 7. Pipeline modes

`PIPELINE_MODE=http` (default) fans out one function invocation per document, each with its own 800s budget and memory.

`PIPELINE_MODE=inline` runs the pipeline in-process. Use it when exercising the pipeline from a script with no server running. Both modes call the identical `processDocument` / `maybeFinalize` core, so behaviour cannot diverge — only timeout and isolation do.
