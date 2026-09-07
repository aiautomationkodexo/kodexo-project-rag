-- ═══════════════════════════════════════════════════════════════════════════
-- portfolio-knowledge-rag — COMPLETE SUPABASE SETUP
--
-- ⚠ GENERATED FILE — DO NOT EDIT.
--   Source: supabase/migrations/*.sql then supabase/seed/*.sql
--   Regenerate with: npm run build:sql
--   Editing this file directly means the next regeneration silently discards
--   your change. Edit the migration instead.
--
-- WHAT THIS IS FOR
--   Standing up a brand-new Supabase project in one paste, including when
--   moving to a different Supabase account. Everything the app needs:
--   schema, RLS, taxonomy, storage, realtime, RPCs, the privilege lockdown,
--   and the super admin.
--
-- HOW TO RUN
--   Dashboard → SQL Editor → paste → Run. It runs as `postgres`, which is
--   the privilege level the storage and publication statements want.
--   (`npm run db:push` remains the normal path for an already-linked project;
--   this file is the portable one.)
--
-- FOR A FRESH, EMPTY PROJECT. This is NOT idempotent as a whole: 0001 uses
-- `create table`, so running it against a database that already has the schema
-- stops at the first table with "relation already exists" and changes nothing.
-- That is a safety feature, not a limitation — it refuses to half-modify an
-- existing install rather than quietly diverging from it. (Verified: a re-run
-- errors immediately and leaves every row count untouched.)
--
-- To re-assert ONLY the super admin on an existing project — or to point it at
-- a different person — run supabase/seed/0100_super_admin.sql on its own. That
-- file IS idempotent, and the two values to change are at the top of it.
--
-- AFTER RUNNING, verify with `npm run verify:cloud`. Migration 0004 fails
-- SOFT by design — it downgrades a privilege error to a warning so that a
-- storage hiccup cannot strand 0005-0007 (an unapplied 0007 leaves a
-- privilege-escalation hole open). So a clean run is NOT proof; check.
--
-- STILL NOT DONE BY THIS FILE (see SETUP.md):
--   • Auth settings, SMTP and the magic-link template — `npm run config:push`
--   • Storage → Settings global file size limit (caps the bucket's 50 MB)
--   • Asymmetric JWT signing keys
--
-- Sections: 0001_schema.sql, 0002_rls.sql, 0003_taxonomy.sql, 0004_storage_realtime.sql, 0005_rpc.sql, 0006_soft_delete.sql, 0007_privilege_lockdown.sql, 0008_magic_link_throttle.sql, 0100_super_admin.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0001_schema.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0001 — Schema, helper functions, triggers, grants
-- Transcribed from PRD §4 with the defects noted inline.  Do not copy the PRD
-- SQL verbatim; several fixes below are load-bearing.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ── Identity ───────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  is_active boolean not null default true,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table user_claims (
  user_id uuid not null references profiles(id) on delete cascade,
  claim text not null,
  primary key (user_id, claim)
);

create index on profiles (email);
create index on profiles (is_active) where deleted_at is null;

-- ── Taxonomy ───────────────────────────────────────────────────────────────

create table industries (name text primary key);

create table tech_tags (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  is_approved boolean not null default true,
  created_at timestamptz not null default now()
);

-- Alias keys are lower(name) with non-alphanumerics stripped (PRD §7).
create table tech_tag_aliases (
  alias text primary key,
  tech_tag_id uuid not null references tech_tags(id) on delete cascade
);

create index on tech_tags (is_approved);

-- ── Projects ───────────────────────────────────────────────────────────────

create table projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) >= 3),
  description text,
  status text not null default 'processing'
    check (status in ('processing','finalizing','ready')),
  industry text references industries(name),
  industry_confidence real,
  -- { "sections": [ {key,label,content}, ... ] } — an ORDERED ARRAY, so display
  -- order is explicit and sections can be appended without key collisions.
  summary jsonb,
  summary_text text,                        -- rendered prose: display + embedding
  summary_embedding extensions.vector(1536),
  created_by uuid references profiles(id),
  last_updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table project_tech_tags (
  project_id uuid not null references projects(id) on delete cascade,
  tech_tag_id uuid not null references tech_tags(id) on delete cascade,
  primary key (project_id, tech_tag_id)
);

-- Version history is the rollback path for a bad regeneration (PRD §11).
create table project_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  summary jsonb not null,
  summary_text text,
  created_at timestamptz not null default now()
);

create index on projects (created_at desc) where deleted_at is null;
create index on projects (status);
create index on projects (industry) where deleted_at is null;
create index on project_tech_tags (tech_tag_id);
create index on project_summaries (project_id, created_at desc);

-- NOTE: currently DEAD. search_projects only ranks over `chunks`; nothing
-- queries projects.summary_embedding with a vector operator. Kept because the
-- project-level arm is an obvious future RRF input and the write cost is
-- trivial at this scale — but it is not load-bearing. Do not assume it is.
create index projects_summary_embedding_idx
  on projects using hnsw (summary_embedding extensions.vector_cosine_ops);

-- ── Documents ──────────────────────────────────────────────────────────────

create table documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  filename text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  storage_key text,                        -- null for the synthetic document
  content_hash text,
  -- FREE TEXT, deliberately. "client testimonial", "kickoff call", "award
  -- submission". No enum survives contact with real usage, and the value is
  -- passed verbatim to the summariser as context (PRD §4, §11).
  doc_role text,
  status text not null default 'queued'
    check (status in ('queued','processing','done','failed')),
  raw_text text,                           -- §15.2: NEVER drop. Re-chunk path.
  error text,
  attempts int not null default 0,
  is_synthetic boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index documents_project_hash_idx
  on documents (project_id, content_hash) where content_hash is not null;
create unique index documents_one_synthetic_idx
  on documents (project_id) where is_synthetic;
create index on documents (project_id);
create index on documents (status, updated_at);

-- ── Chunks ─────────────────────────────────────────────────────────────────
-- §15.3: chunks are immutable. Corrections are new documents, never edits.

create table chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  ordinal int not null,
  text text not null,
  embedding extensions.vector(1536),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- FIX (not in PRD): stored generated tsvector.
  -- The PRD's RPC calls ts_rank(to_tsvector('english', c.text), ...), which
  -- recomputes the tsvector for every candidate row at rank time — the GIN
  -- expression index accelerates the @@ filter, not the ranking. Retrofitting
  -- this after `chunks` has grown means a full-table rewrite, so do it now.
  tsv tsvector generated always as (to_tsvector('english', text)) stored
);

create index on chunks (project_id) where is_active;
create index on chunks (document_id);

-- HNSW, not IVFFlat. HNSW builds its graph incrementally, so creating it on an
-- empty table is correct. IVFFlat derives cluster centroids from data present
-- at build time and would produce a degenerate index here. 1536 dims is well
-- inside HNSW's 2000-dim limit.
-- Partial, to match the RPC's predicate (`is_active and embedding is not null`).
create index chunks_embedding_idx on chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  where is_active and embedding is not null;

create index chunks_tsv_idx on chunks using gin (tsv);

-- ── Audit ──────────────────────────────────────────────────────────────────

create table audit_log (
  id bigserial primary key,
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  meta jsonb,
  at timestamptz not null default now()
);

create index on audit_log (entity_type, entity_id, at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- Helper functions
--
-- SECURITY DEFINER is REQUIRED here, not incidental: profiles_select calls
-- has_claim(), which selects from profiles. Without definer rights that is
-- infinite RLS recursion. Do not "clean this up".
--
-- `set search_path = public, extensions, pg_temp` — naming pg_temp explicitly,
-- and LAST, is a security fix over the PRD's `= public`. Postgres implicitly
-- searches the temp schema FIRST unless pg_temp appears in the path, so with
-- the PRD's version any authenticated user could `create temp table profiles`
-- and have has_claim() — running as the definer — resolve against their own
-- table. That is full privilege escalation through every RLS policy.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function is_active_user(uid uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from profiles
                 where id = uid and is_active and deleted_at is null);
$$;

create or replace function is_super_admin(uid uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from profiles
                 where id = uid and is_super_admin and is_active and deleted_at is null);
$$;

-- §15.1: the ONLY authorization predicate. is_super_admin short-circuits to
-- true so future claims are covered without touching callers. Never compare
-- against a role string anywhere in this system.
create or replace function has_claim(uid uuid, c text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select is_active_user(uid) and (
    is_super_admin(uid)
    or exists (select 1 from user_claims where user_id = uid and claim = c)
  );
$$;

create or replace function assert_not_last_super_admin(target uuid)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare n int;
begin
  if not exists (select 1 from profiles where id = target and is_super_admin
                 and is_active and deleted_at is null) then return; end if;
  select count(*) into n from profiles
   where is_super_admin and is_active and deleted_at is null;
  if n <= 1 then raise exception 'Cannot remove the last active super admin'; end if;
end;
$$;

create or replace function guard_super_admin() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if (old.is_super_admin and not new.is_super_admin)
     or (old.is_active and not new.is_active)
     or (old.deleted_at is null and new.deleted_at is not null) then
    perform assert_not_last_super_admin(old.id);
  end if;
  return new;
end;
$$;

create or replace function guard_super_admin_delete() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin perform assert_not_last_super_admin(old.id); return old; end;
$$;

create trigger profiles_guard_super_admin before update on profiles
  for each row execute function guard_super_admin();
create trigger profiles_guard_delete before delete on profiles
  for each row execute function guard_super_admin_delete();

create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger projects_touch  before update on projects
  for each row execute function touch_updated_at();
create trigger documents_touch before update on documents
  for each row execute function touch_updated_at();
create trigger profiles_touch  before update on profiles
  for each row execute function touch_updated_at();

-- Super admins get no rows here on purpose: has_claim() short-circuits on
-- is_super_admin, so an empty user_claims set is correct for them.
create or replace function grant_default_claims() returns trigger
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not new.is_super_admin then
    insert into user_claims (user_id, claim) values (new.id, 'projects:view')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger profiles_default_claims after insert on profiles
  for each row execute function grant_default_claims();

-- ═══════════════════════════════════════════════════════════════════════════
-- Execute grants
--
-- FIX (not in PRD): Postgres grants EXECUTE to PUBLIC by default. Without the
-- revokes below, any authenticated user could call
-- has_claim('<someone-elses-uuid>', 'users:delete') and enumerate other
-- people's permissions.
--
-- Revoking from public does NOT break RLS policies that call has_claim():
-- policy expressions are evaluated by the executor, not as a user-initiated
-- function call.
-- ═══════════════════════════════════════════════════════════════════════════

revoke execute on function is_active_user(uuid), is_super_admin(uuid),
  has_claim(uuid, text), assert_not_last_super_admin(uuid) from public;
grant execute on function is_active_user(uuid), is_super_admin(uuid),
  has_claim(uuid, text) to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0002_rls.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 — Row Level Security
--
-- TWO FIXES over PRD §5, both important:
--
-- 1. The PRD says "Enable on all tables" but ships no statements. Supabase's
--    bootstrap grants `authenticated` access to public tables, so a table
--    created without `enable row level security` is readable by every signed-in
--    user regardless of policies. All eleven are enabled explicitly below.
--
-- 2. A policy expression calling a function that reads auth.uid() is evaluated
--    ONCE PER CANDIDATE ROW. On a 500-row select that is 500 has_claim() calls,
--    each running three subqueries. Wrapping the call in a scalar subquery lets
--    the planner hoist it into an InitPlan evaluated once per statement — worth
--    10-100x on list queries. The helpers are declared `stable`, which is what
--    makes the hoist legal.
--
--    This is NOT applied blanket: see claims_insert / claims_delete below.
-- ═══════════════════════════════════════════════════════════════════════════

alter table profiles          enable row level security;
alter table user_claims       enable row level security;
alter table industries        enable row level security;
alter table tech_tags         enable row level security;
alter table tech_tag_aliases  enable row level security;
alter table projects          enable row level security;
alter table project_tech_tags enable row level security;
alter table project_summaries enable row level security;
alter table documents         enable row level security;
alter table chunks            enable row level security;
alter table audit_log         enable row level security;

-- ── profiles ───────────────────────────────────────────────────────────────
-- No INSERT policy on purpose: profiles are created through the service role
-- during seeding and T5 user creation. Do not "fix" this by adding one.

create policy profiles_select on profiles for select to authenticated
using (id = (select auth.uid())
       or (select has_claim((select auth.uid()), 'users:view')));

create policy profiles_update_self on profiles for update to authenticated
using (id = (select auth.uid()) and (select is_active_user((select auth.uid()))))
with check (id = (select auth.uid()));

create policy profiles_update_admin on profiles for update to authenticated
using ((select has_claim((select auth.uid()), 'users:update')))
with check ((select has_claim((select auth.uid()), 'users:update')));

create policy profiles_delete on profiles for delete to authenticated
using ((select has_claim((select auth.uid()), 'users:delete')));

-- ── user_claims ────────────────────────────────────────────────────────────
-- The privilege-escalation guard is the SECOND condition on insert/delete:
-- you may only grant or revoke a claim you hold yourself.
--
-- That arm references `claim` from the row being written, so it is genuinely
-- row-correlated and MUST NOT be wrapped in a scalar subquery — hoisting it
-- would evaluate it once against an arbitrary row and defeat the guard.
-- Wrapping the inner auth.uid() alone is always safe.

create policy claims_select on user_claims for select to authenticated
using (user_id = (select auth.uid())
       or (select has_claim((select auth.uid()), 'users:view')));

create policy claims_insert on user_claims for insert to authenticated
with check ((select has_claim((select auth.uid()), 'users:update'))  -- hoisted
            and has_claim((select auth.uid()), claim));              -- per-row: correct

create policy claims_delete on user_claims for delete to authenticated
using ((select has_claim((select auth.uid()), 'users:update'))       -- hoisted
       and has_claim((select auth.uid()), claim));                   -- per-row: correct

-- ── projects ───────────────────────────────────────────────────────────────

create policy projects_select on projects for select to authenticated
using (deleted_at is null
       and (select has_claim((select auth.uid()), 'projects:view')));

create policy projects_insert on projects for insert to authenticated
with check ((select has_claim((select auth.uid()), 'projects:create')));

-- with check added (PRD had `using` only): validate the post-image too.
create policy projects_update on projects for update to authenticated
using (deleted_at is null
       and (select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

create policy projects_delete on projects for delete to authenticated
using ((select has_claim((select auth.uid()), 'projects:delete')));

-- ── project children ───────────────────────────────────────────────────────

create policy ptt_select on project_tech_tags for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy ptt_write on project_tech_tags for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

create policy summaries_select on project_summaries for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy documents_select on documents for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy documents_insert on documents for insert to authenticated
with check ((select has_claim((select auth.uid()), 'projects:update'))
            or (select has_claim((select auth.uid()), 'projects:create')));

create policy documents_update on documents for update to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

create policy documents_delete on documents for delete to authenticated
using ((select has_claim((select auth.uid()), 'projects:delete')));

-- Read-only to clients. Chunks are written exclusively by the pipeline via the
-- service role, which bypasses RLS entirely.
create policy chunks_select on chunks for select to authenticated
using (is_active and (select has_claim((select auth.uid()), 'projects:view')));

-- ── taxonomy ───────────────────────────────────────────────────────────────

create policy industries_select on industries for select to authenticated
using ((select is_active_user((select auth.uid()))));

create policy tags_select on tech_tags for select to authenticated
using ((select is_active_user((select auth.uid()))));

create policy tags_write on tech_tags for all to authenticated
using ((select is_super_admin((select auth.uid()))))
with check ((select is_super_admin((select auth.uid()))));

create policy aliases_select on tech_tag_aliases for select to authenticated
using ((select is_active_user((select auth.uid()))));

create policy aliases_write on tech_tag_aliases for all to authenticated
using ((select is_super_admin((select auth.uid()))))
with check ((select is_super_admin((select auth.uid()))));

-- ── audit ──────────────────────────────────────────────────────────────────
-- Read-only even to super admins. Writes go through the service role.

create policy audit_select on audit_log for select to authenticated
using ((select is_super_admin((select auth.uid()))));


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0003_taxonomy.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 — Taxonomy seed (PRD §7)
-- Idempotent: safe to re-run. `on conflict do nothing` throughout.
-- ═══════════════════════════════════════════════════════════════════════════

insert into industries (name) values
  ('Fintech'), ('Healthcare'), ('E-commerce'), ('Logistics'), ('EdTech'),
  ('Real Estate'), ('Manufacturing'), ('Media & Entertainment'), ('Gaming'),
  ('Travel & Hospitality'), ('Insurance'), ('Legal'), ('HR & Recruiting'),
  ('Marketing & AdTech'), ('Energy'), ('Government'), ('Telecom'),
  ('Agriculture'), ('Non-profit'), ('Other')
on conflict (name) do nothing;

insert into tech_tags (canonical_name, is_approved) values
  -- languages
  ('JavaScript', true), ('TypeScript', true), ('Python', true), ('Java', true),
  ('C#', true), ('Go', true), ('Rust', true), ('PHP', true), ('Ruby', true),
  ('Kotlin', true), ('Swift', true), ('Dart', true), ('SQL', true),
  -- frontend
  ('React', true), ('Next.js', true), ('Vue.js', true), ('Nuxt', true),
  ('Angular', true), ('Svelte', true), ('React Native', true), ('Flutter', true),
  ('Tailwind CSS', true), ('Redux', true),
  -- backend
  ('Node.js', true), ('Express', true), ('NestJS', true), ('Django', true),
  ('FastAPI', true), ('Flask', true), ('Spring Boot', true), ('.NET', true),
  ('Laravel', true), ('Ruby on Rails', true), ('GraphQL', true), ('REST API', true),
  -- data
  ('PostgreSQL', true), ('MySQL', true), ('MongoDB', true), ('Redis', true),
  ('Elasticsearch', true), ('Supabase', true), ('Firebase', true),
  ('DynamoDB', true), ('SQLite', true), ('ClickHouse', true), ('Snowflake', true),
  ('BigQuery', true), ('pgvector', true), ('Pinecone', true),
  -- infra
  ('AWS', true), ('Google Cloud', true), ('Azure', true), ('Vercel', true),
  ('Docker', true), ('Kubernetes', true), ('Terraform', true),
  ('GitHub Actions', true), ('Nginx', true), ('Cloudflare', true), ('Kafka', true),
  ('RabbitMQ', true), ('Celery', true),
  -- AI
  ('OpenAI', true), ('LangChain', true), ('RAG', true), ('TensorFlow', true),
  ('PyTorch', true), ('Hugging Face', true), ('Whisper', true), ('Deepgram', true),
  -- other
  ('Stripe', true), ('Twilio', true), ('Auth0', true), ('Shopify', true),
  ('WordPress', true), ('Figma', true)
on conflict (canonical_name) do nothing;

-- ── Self-aliases ───────────────────────────────────────────────────────────
-- PRD §7: "Also insert every canonical name as a self-alias."
-- The alias key is lower(name) with non-alphanumerics stripped, so 'Next.js'
-- keys as 'nextjs', 'C#' as 'c', '.NET' as 'net'. Derived rather than typed out
-- so the normalisation rule lives in exactly one place.
insert into tech_tag_aliases (alias, tech_tag_id)
select regexp_replace(lower(canonical_name), '[^a-z0-9]', '', 'g'), id
from tech_tags
on conflict (alias) do nothing;

-- ── Explicit aliases (PRD §7) ──────────────────────────────────────────────
insert into tech_tag_aliases (alias, tech_tag_id)
select a.alias, t.id
from (values
  ('js','JavaScript'), ('ecmascript','JavaScript'), ('es6','JavaScript'),
  ('ts','TypeScript'),
  ('py','Python'), ('python3','Python'),
  ('csharp','C#'), ('cs','C#'),
  ('golang','Go'),
  ('reactjs','React'),
  ('nextjs','Next.js'), ('next','Next.js'),
  ('vue','Vue.js'), ('vuejs','Vue.js'),
  ('node','Node.js'), ('nodejs','Node.js'),
  ('rails','Ruby on Rails'), ('ror','Ruby on Rails'),
  ('postgres','PostgreSQL'), ('postgresql','PostgreSQL'), ('psql','PostgreSQL'),
  ('mongo','MongoDB'), ('mongodb','MongoDB'),
  ('es','Elasticsearch'), ('elastic','Elasticsearch'),
  ('gcp','Google Cloud'), ('googlecloud','Google Cloud'),
  ('k8s','Kubernetes'), ('kube','Kubernetes'),
  ('gpt','OpenAI'), ('gpt4','OpenAI'), ('chatgpt','OpenAI'),
  ('tf','TensorFlow'),
  ('torch','PyTorch'),
  ('tailwind','Tailwind CSS'), ('tailwindcss','Tailwind CSS'),
  ('aspnet','.NET'), ('dotnetcore','.NET')
) as a(alias, canonical)
join tech_tags t on t.canonical_name = a.canonical
on conflict (alias) do nothing;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0004_storage_realtime.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 — Storage bucket + policies, Realtime publication
--
-- PRD §3 puts both of these in the dashboard. They belong in a migration:
-- a dashboard click is not reviewable, not reproducible on a fresh project,
-- and not applied by a migration run.
--
-- HOSTED-SAFE, and that shapes this entire file. `supabase db push` applies
-- migrations in order and STOPS at the first error — so a statement that fails
-- here does not merely lose a bucket, it leaves 0005 (search_projects), 0006
-- (soft delete) and 0007 (the privilege lockdown) UNAPPLIED. An unapplied 0007
-- means the profiles privilege-escalation hole is live on the new project.
--
-- Every block below is therefore idempotent AND wrapped so a privilege error
-- can only downgrade to a WARNING. Each `do $$ … exception … $$` is a
-- subtransaction, so a caught error leaves the outer transaction healthy and
-- the rest of the file still runs.
--
-- THE COST OF THAT CHOICE: a swallowed error means this migration records as
-- applied with its work half-done. The verification queries in SETUP.md are
-- not optional — run them after every push.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Bucket ─────────────────────────────────────────────────────────────────
-- Private. 50 MB per file (PRD §10), mirroring the documents.size_bytes CHECK
-- so the limit is enforced on both sides of the upload.
--
-- Also declared in supabase/config.toml as [storage.buckets.project-files],
-- where `supabase seed buckets --linked` can create it through the Storage
-- REST API — a path that runs as the storage service and cannot hit a Postgres
-- ownership error. This INSERT is the belt; that command is the braces. Keep
-- the two byte-identical.
--
-- ON CONFLICT DO UPDATE, not DO NOTHING: this file is the source of truth for
-- the MIME allow-list, so a replay must be able to correct a bucket created by
-- `seed buckets` from a stale config.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'project-files',
    'project-files',
    false,
    52428800,
    array[
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a',
      'video/mp4', 'video/quicktime'
    ]
  )
  on conflict (id) do update set
    public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
exception
  when insufficient_privilege then
    raise warning
      '0004: cannot write storage.buckets as %. Run: npm run buckets:push',
      current_user;
end $$;


-- ── Storage policies ───────────────────────────────────────────────────────
-- Path convention: projects/{project_id}/{document_id}/{filename}
-- Same InitPlan-hoisting treatment as 0002: (select …) so the claim check is
-- evaluated once per statement rather than once per row.
--
-- NOTE FOR THE REVIEWER: these are DEFENCE IN DEPTH ONLY and are not on any
-- live code path today. Every Storage call in this app uses the service-role
-- client and bypasses RLS — /api/upload-url mints a signed upload URL (that
-- URL's own token is the browser's authorisation) and lib/pipeline/extract.ts
-- downloads as admin. Nothing reads or writes storage.objects as
-- `authenticated`. That is exactly why a WARNING here is acceptable where an
-- aborted push is not. If a user-scoped Storage path is ever added, these stop
-- being decorative — re-check them first.
--
-- has_claim is schema-qualified: a policy expression is resolved against the
-- search_path in force at CREATE time, and `db push` does not guarantee one.
do $$
begin
  drop policy if exists storage_read   on storage.objects;
  drop policy if exists storage_write  on storage.objects;
  drop policy if exists storage_delete on storage.objects;

  create policy storage_read on storage.objects for select to authenticated
  using (bucket_id = 'project-files'
         and (select public.has_claim((select auth.uid()), 'projects:view')));

  create policy storage_write on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files'
              and ((select public.has_claim((select auth.uid()), 'projects:create'))
                or (select public.has_claim((select auth.uid()), 'projects:update'))));

  create policy storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-files'
         and (select public.has_claim((select auth.uid()), 'projects:delete')));
exception
  when insufficient_privilege then
    raise warning
      '0004: cannot manage policies on storage.objects as % — SKIPPED. '
      'No live code path depends on them (all Storage access is service-role). '
      'Recreate from Storage -> Policies before adding any user-scoped access.',
      current_user;
end $$;


-- ── Realtime ───────────────────────────────────────────────────────────────
-- Drives the live status panel on /projects/[id].
--
-- `replica identity full` is deliberately NOT set: the client only reads
-- payload.new.status, and the default PK replica identity populates `new` on
-- UPDATE. Add it only if payload.old is ever needed — it doubles WAL volume.
--
-- Note RLS IS applied to postgres_changes, per subscriber, on every event.
-- DELETE events are the exception: Postgres cannot verify access to a deleted
-- row, so RLS does not apply. Never carry data in a delete payload.
--
-- THE GUARD: `alter publication … add table` is NOT idempotent — a replay
-- raises 42710 "relation is already member of publication", and before this
-- guard that single statement would abort the push and strand 0005-0007.
-- pg_publication_tables is a plain catalog view readable by postgres, so the
-- membership probe cannot itself fail on privileges.
--
-- UNLIKE the two blocks above, a skip here is NOT harmless: the /projects/[id]
-- status panel silently never updates. The SETUP.md verification query for
-- this one is mandatory.
do $$
declare
  t text;
begin
  foreach t in array array['projects', 'documents'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname    = 'supabase_realtime'
        and schemaname = 'public'
        and tablename  = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception
  when undefined_object then
    raise warning
      '0004: publication supabase_realtime does not exist — SKIPPED. '
      'The live status panel on /projects/[id] will never update.';
  when insufficient_privilege then
    raise warning
      '0004: cannot alter publication supabase_realtime as % — SKIPPED. '
      'Enable Realtime for public.projects and public.documents in the dashboard.',
      current_user;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0005_rpc.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 — Search and pipeline RPCs
--
-- search_projects is the single hybrid-search entry point. PostgREST cannot
-- express pgvector operators, so every similarity query MUST go through .rpc();
-- there is no .select().order('embedding <=> ...') alternative.
-- ═══════════════════════════════════════════════════════════════════════════

-- FIX: default floor raised 0.15 → 0.30.
--
-- text-embedding-3-small vectors are not zero-centred. Two completely unrelated
-- English paragraphs routinely score 0.10–0.30 cosine; related-but-not-matching
-- lands 0.30–0.45; genuine matches sit 0.50+. At 0.15 the floor admits
-- essentially everything the ANN scan returns, so the vector arm can never
-- return an empty set and §15.5 ("search must be able to return nothing") is
-- not enforced in practice — which also makes the PRD's own empty state,
-- "No strong matches for that search", unreachable.
--
-- Re-tune against a real corpus once one exists.
create or replace function search_projects(
  query_embedding extensions.vector(1536),
  query_text text default '',
  filter_industry text default null,
  filter_tags uuid[] default null,
  match_limit int default 10,
  min_similarity real default 0.30
)
returns table (project_id uuid, score real, best_snippet text, best_source text)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
begin
  -- SECURITY DEFINER bypasses RLS on projects/chunks/documents, so this guard
  -- IS the access check. That is correct today because projects:view is
  -- all-or-nothing with no per-project ACL.
  --
  -- STANDING INVARIANT: if per-project visibility is ever introduced, this
  -- function leaks every project to anyone holding projects:view until the
  -- `eligible` CTE is taught the same rule. RLS will not save you inside a
  -- definer function.
  if not has_claim((select auth.uid()), 'projects:view') then
    raise exception 'Missing permission: projects:view';
  end if;

  -- Widen the HNSW candidate pool. The vec CTE joins `eligible` AFTER the ANN
  -- scan, so with an industry/tag filter the top-N candidates can collapse to
  -- near zero eligible rows. Invisible at small scale (the planner seqscans and
  -- searches exactly); a silent recall problem as the corpus grows.
  -- pgvector 0.8's hnsw.iterative_scan = 'relaxed_order' is the real fix later.
  perform set_config('hnsw.ef_search', '100', true);

  return query
  -- §15.4: filters are PRE-filters, applied inside the SQL before ranking —
  -- never to a result set afterwards.
  with eligible as (
    select p.id from projects p
    where p.deleted_at is null
      and (filter_industry is null or p.industry = filter_industry)
      and (filter_tags is null or not exists (
        select 1 from unnest(filter_tags) t(tag)
        where not exists (select 1 from project_tech_tags ptt
                          where ptt.project_id = p.id and ptt.tech_tag_id = t.tag)))
  ),
  vec as (
    select c.id, c.project_id as pid, c.text, c.document_id,
           1 - (c.embedding <=> query_embedding) as sim,
           row_number() over (order by c.embedding <=> query_embedding) as rnk
    from chunks c join eligible e on e.id = c.project_id
    where c.is_active and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit 60
  ),
  fts as (
    select c.id, c.project_id as pid, c.text, c.document_id,
           row_number() over (order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc) as rnk
    from chunks c join eligible e on e.id = c.project_id
    where c.is_active and query_text <> ''
      and c.tsv @@ websearch_to_tsquery('english', query_text)
    -- FIX: the PRD had `limit 60` with NO order by at the CTE level. The window
    -- function ranked the whole matching set correctly, then an ARBITRARY 60
    -- rows survived the limit — rank #1 could be discarded while rank #4000 was
    -- kept, non-deterministically across runs. Compare the vec CTE, which was
    -- correctly ordered. This silently halved lexical search quality.
    order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc
    limit 60
  ),
  fused as (
    -- Reciprocal Rank Fusion. Cosine similarity (0–1) and ts_rank (unbounded)
    -- are not comparable numbers; ranks are. 1/(60+rank) from each list, summed.
    select coalesce(v.pid, f.pid) as pid,
           coalesce(v.text, f.text) as text,
           coalesce(v.document_id, f.document_id) as did,
           v.id as vec_id,
           f.id as fts_id,
           v.sim as sim,
           coalesce(1.0/(60+v.rnk),0) + coalesce(1.0/(60+f.rnk),0) as rrf
    from vec v full outer join fts f on f.id = v.id
  ),
  ranked as (
    -- DISTINCT ON keeps the first row per project under this ORDER BY, so the
    -- surviving row IS that project's highest-RRF chunk — best_snippet and
    -- best_source therefore come from the best-ranked chunk.
    --
    -- This is MAX-pooling: a project scores as its single best chunk, not an
    -- aggregate. Deliberate. Summing RRF across chunks would systematically
    -- favour projects with more chunks — a 40-page PDF would beat a sharp
    -- 200-word description. Do not "fix" this to sum().
    select distinct on (pid) pid, rrf, text, did
    from fused
    -- FIX: the PRD used `sim >= min_similarity or sim = 0`, relying on the
    -- float 0.0 as a sentinel for "FTS-only row". Mechanically it worked, but
    -- a genuine similarity of exactly 0.0 would pass the floor spuriously.
    -- Testing fts_id directly says the same thing without the sentinel.
    --
    -- The FTS arm is deliberately unfloored: ts_rank is unbounded and
    -- uncalibrated, so there is no principled threshold, and a
    -- websearch_to_tsquery match is an exact lexical hit — a legitimate result.
    -- §15.5 is therefore enforced on the vector arm, which is the arm that
    -- generates spurious matches.
    where fts_id is not null or sim >= min_similarity
    order by pid, rrf desc
  )
  select r.pid,
         r.rrf::real,
         left(r.text, 300),
         -- FIX: the PRD's coalesce(d.filename, 'description') is unreachable —
         -- chunks.document_id is NOT NULL with an FK, so the left join always
         -- matches and filename is NOT NULL. The synthetic document carries
         -- filename 'description' anyway; this makes the intent explicit.
         case when d.is_synthetic then 'description' else d.filename end
  from ranked r
  left join documents d on d.id = r.did
  order by r.rrf desc
  limit match_limit;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Pipeline RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- §15.6: THE ONLY finalization gate.
--
-- Parallel completion means several invocations can each believe they are last.
-- A single conditional UPDATE resolves it — Postgres guarantees exactly one
-- winner. Do not replace this with an application-level "am I last?" check.
--
-- FIX: `and is_active` added to the pending count. Without it a document
-- deactivated while queued blocks finalization permanently.
create or replace function claim_finalize(p_project uuid)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare pending int;
begin
  select count(*) into pending from documents d
  where d.project_id = p_project
    and d.is_active
    and d.status in ('queued','processing');

  if pending > 0 then return false; end if;

  update projects set status = 'finalizing'
  where id = p_project and status = 'processing';

  return found;
end;
$$;

-- NOT IN THE PRD. Same single-conditional-UPDATE shape as claim_finalize,
-- applied one level down: it is what stops the cron sweep from double-
-- processing a document that a slow-but-alive invocation still holds.
--
-- Returns true only if THIS caller won the right to process the document.
create or replace function claim_document(p_document uuid)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  update documents
     set status = 'processing', attempts = attempts + 1
   where id = p_document
     and is_active
     and (status = 'queued'
          or (status = 'processing' and updated_at < now() - interval '15 minutes'));
  return found;
end;
$$;

-- FIX: the PRD selected only status = 'processing'. But the error path sets a
-- retryable document back to 'queued', and claim_finalize counts 'queued' as
-- pending — so a document that failed once was never retried AND its project
-- sat in 'processing' forever. One transient OpenAI 429 was enough to strand a
-- project permanently, which would have made T4's acceptance criterion a coin
-- flip.
--
-- Columns are qualified via the `d` alias: the OUT parameters are named `id`
-- and `project_id`, which collide with the table's own column names in a
-- language-sql body.
create or replace function stuck_documents(older_than_minutes int default 15)
returns table (id uuid, project_id uuid)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select d.id, d.project_id
  from documents d
  where d.is_active
    and d.status in ('queued','processing')
    and d.updated_at < now() - (older_than_minutes || ' minutes')::interval
    and d.attempts < 3
  limit 50;
$$;

-- ── Execute grants ─────────────────────────────────────────────────────────
-- claim_finalize and claim_document are unguarded state mutations; without the
-- revoke, any authenticated user could flip an arbitrary project to
-- 'finalizing'. They are called only by the pipeline, which uses the service
-- role.
revoke execute on function claim_finalize(uuid), claim_document(uuid),
  stuck_documents(int) from public;
grant execute on function claim_finalize(uuid), claim_document(uuid),
  stuck_documents(int) to service_role;

-- search_projects stays available to authenticated; its own has_claim guard
-- is the gate.
revoke execute on function
  search_projects(extensions.vector, text, text, uuid[], int, real) from public;
grant execute on function
  search_projects(extensions.vector, text, text, uuid[], int, real)
  to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0006_soft_delete.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 — Soft delete
--
-- DEFECT IN THE PRD (§5), found by testing a real soft delete as a real user:
--
--   projects_select  USING (deleted_at is null AND has_claim(...,'projects:view'))
--   projects_update  USING (deleted_at is null AND has_claim(...,'projects:update'))
--
-- During an UPDATE, PostgreSQL checks the NEW row against the SELECT policy as
-- well (the row must remain visible to its writer). Setting deleted_at makes
-- the new row fail `deleted_at is null`, so Postgres raises
--
--   ERROR: new row violates row-level security policy for table "projects"
--
-- Net effect: soft delete is IMPOSSIBLE through the user's client, no matter
-- which claims they hold. Verified: updating `title` succeeds while updating
-- `deleted_at` on the same row fails, and dropping `deleted_at is null` from
-- projects_select makes it succeed.
--
-- Loosening projects_select is not an option — that is what hides deleted
-- projects from every listing and from search. Instead, route the one write
-- that must escape its own visibility rule through a definer function that
-- performs the SAME claim check the policy would have. Authorization stays in
-- SQL; RLS remains the boundary for everything else.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function soft_delete_project(p_project uuid)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  -- The same predicate projects_delete would have applied. §15.1: claims only.
  if not has_claim((select auth.uid()), 'projects:delete') then
    raise exception 'Missing permission: projects:delete';
  end if;

  update projects
     set deleted_at = now()
   where id = p_project
     and deleted_at is null;

  return found;
end;
$$;

revoke execute on function soft_delete_project(uuid) from public;
grant execute on function soft_delete_project(uuid) to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0007_privilege_lockdown.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 — Privilege lockdown on `profiles`
--
-- FIXES A LIVE PRIVILEGE ESCALATION inherited from PRD §5.
--
-- `profiles_update_self` permits a self-update with WITH CHECK (id = auth.uid())
-- and NO column restriction, and Supabase's default privileges grant UPDATE on
-- every column of every public table to `authenticated` AND `anon`. So any
-- signed-in user could:
--
--   PATCH /rest/v1/profiles?id=eq.<self>   {"is_super_admin": true}
--
-- and become super admin — which short-circuits has_claim() to true for every
-- claim in the system. Exploitable with nothing but the publishable key and a
-- session; no UI involvement required.
--
-- ── Why not just rewrite the policies ────────────────────────────────────
-- A WITH CHECK expression CANNOT reference OLD, so it can only express absolute
-- rules, never transitions. `is_super_admin = false` would break a super admin
-- editing their own name (their row legitimately has it true), and
-- profiles_update_admin cannot pin the column at all because it must serve rows
-- of both kinds. Dead end.
--
-- ── Why not column grants alone ──────────────────────────────────────────
-- `authenticated` is ONE role. Column privileges are role-scoped, so they
-- cannot distinguish "a user editing their own name" from "a users:update
-- holder deactivating someone". is_active/deleted_at must remain writable by
-- SOME authenticated principals, so any grant permitting them permits everyone.
--
-- ── Why not a trigger alone ──────────────────────────────────────────────
-- A trigger runs after the privilege check and after RLS, and is one
-- CREATE OR REPLACE away from being weakened. Column privileges fail at
-- permission-check time with 42501 before a row is touched, and — decisively —
-- they FAIL CLOSED FOR COLUMNS ADDED LATER: once table-level UPDATE is revoked,
-- any column a future migration adds is un-updatable by `authenticated` until
-- someone deliberately grants it.
--
-- ── Decision: both, each doing what it is uniquely good at ───────────────
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Layer 1: column privileges ─────────────────────────────────────────────
--
-- NOTE: `revoke update (col) ...` does NOT work here. Postgres cannot subtract
-- a column from a table-level grant — it emits
--   WARNING: no privileges could be revoked for column ...
-- and changes nothing. The table-level privilege must be revoked first, then
-- the permitted columns re-granted individually.

revoke update on public.profiles from authenticated, anon;

-- The only three columns any API caller may ever write.
--   name        — self-service, or a users:update holder editing someone
--   is_active   — deactivate/reactivate, gated by the trigger below
--   deleted_at  — soft delete, gated by the trigger below
--
-- Deliberately NOT granted:
--   is_super_admin — never writable through the API. The only sanctioned way to
--                    mint a super admin is scripts/seed-admin.mts (service_role).
--   id             — the PK and the auth.users FK. Immutable.
--   email          — UNIQUE, and it IS the magic-link identity. Rewriting
--                    someone's email hijacks their sign-in.
--   created_at     — immutable.
--   updated_at     — owned by the profiles_touch trigger. A BEFORE trigger's
--                    assignment to NEW does not require the column privilege,
--                    because privileges are checked against the statement's SET
--                    list, not against trigger assignments.
grant update (name, is_active, deleted_at) on public.profiles to authenticated;

-- `anon` gets nothing: every profiles policy is `to authenticated`, so anon
-- could never have passed RLS anyway. This removes the grant that made the
-- hole reachable at all.

-- ── Layer 2: transition guard ──────────────────────────────────────────────
--
-- Column grants say WHICH columns may be written. This says WHO may write them
-- and to what, which is the part grants cannot express.
--
-- Named `profiles_guard_columns` so it sorts BEFORE `profiles_guard_super_admin`
-- and `profiles_touch` — Postgres fires BEFORE triggers in alphabetical order,
-- and this one should reject before the last-super-admin check does its work.

create or replace function guard_profile_columns() returns trigger
language plpgsql security invoker
set search_path = public, extensions, pg_temp as $$
begin
  -- service_role and the migration/superuser roles bypass this entirely.
  -- The seed script, the ingestion pipeline and the cron sweep all connect as
  -- service_role; `current_user` is a reliable discriminator because PostgREST
  -- issues SET LOCAL ROLE per request.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  -- Immutable columns. Belt-and-braces behind the revoked grants: if a future
  -- migration re-grants one of these by accident, this still holds the line.
  if new.id is distinct from old.id then
    raise exception 'profiles.id is immutable' using errcode = '42501';
  end if;
  if new.email is distinct from old.email then
    raise exception 'profiles.email cannot be changed — it is the sign-in identity'
      using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'profiles.created_at is immutable' using errcode = '42501';
  end if;

  -- THE ESCALATION ARM. No API caller may ever change this, not even a super
  -- admin: privilege grants happen through user_claims, whose RLS carries the
  -- per-row `has_claim(uid, claim)` guard that makes "you cannot grant what you
  -- do not hold" a database-level fact. Allowing is_super_admin to be set would
  -- route around that guard entirely.
  if new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'profiles.is_super_admin cannot be changed through the API'
      using errcode = '42501';
  end if;

  -- Deactivate / reactivate requires an admin claim.
  if new.is_active is distinct from old.is_active
     and not (has_claim((select auth.uid()), 'users:update')
              or has_claim((select auth.uid()), 'users:delete')) then
    raise exception 'Missing permission: users:update' using errcode = '42501';
  end if;

  -- Soft delete (and undelete) requires users:delete.
  if new.deleted_at is distinct from old.deleted_at
     and not has_claim((select auth.uid()), 'users:delete') then
    raise exception 'Missing permission: users:delete' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_columns before update on public.profiles
  for each row execute function guard_profile_columns();

-- ── Layer 3: TRUNCATE, defence in depth ────────────────────────────────────
--
-- Supabase's default privileges also grant TRUNCATE on every public table to
-- `authenticated` and `anon`, and TRUNCATE IS NOT SUBJECT TO ROW SECURITY —
-- one statement would empty a table regardless of any policy.
--
-- NOT a live exploit: PostgREST emits no verb that produces a TRUNCATE, and
-- nobody can open a direct connection as `authenticated` (the login role is
-- `authenticator`). It is a free revoke, included because the blast radius if
-- it ever became reachable is total.

revoke truncate on all tables in schema public from authenticated, anon;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0008_magic_link_throttle.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0008 — Magic-link send throttle
--
-- Auth mail no longer goes through GoTrue. The login action now calls
-- auth.admin.generateLink() (which sends nothing and, unlike signInWithOtp, is
-- NOT rate limited) and delivers the link over our own SMTP transport.
--
-- That removes GoTrue's per-address resend interval — the "you can only request
-- this after N seconds" 429 — so we have to reintroduce it ourselves, or the
-- public login form becomes an unthrottled way to spam a known user's inbox and
-- burn the daily sending quota.
--
-- A column rather than a table: there is exactly one row per address already,
-- the lifetime is "last write wins", and no history is wanted.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists last_magic_link_at timestamptz;

-- NOTHING is granted to `authenticated` for this column, and that is automatic:
-- 0007 revoked table-level UPDATE and re-granted only (name, is_active,
-- deleted_at), so every column added afterwards is un-writable through the API
-- until someone deliberately grants it. This is the "fail closed for columns
-- added later" property 0007 was chosen for — 0008 is the first migration to
-- rely on it, so it is worth stating out loud rather than rediscovering.
--
-- The throttle is read and written exclusively by the service role in
-- src/lib/auth/magic-link.ts.

comment on column public.profiles.last_magic_link_at is
  'Service-role only. Last magic-link email sent to this address; drives the '
  'resend throttle that replaced GoTrue''s, now that we send auth mail ourselves.';


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/seed/0100_super_admin.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0100 — Super admin
--
-- NOT a migration. This is bundled into supabase/setup.sql only, because it is
-- environment data rather than schema: `supabase db push` must never carry a
-- named human into a project.
--
-- Creates the auth user AND the profile. profiles.id is an FK onto
-- auth.users(id), so a profile cannot exist on its own — which is why the
-- seed-admin script has to go through the GoTrue admin API. In plain SQL we
-- write both rows ourselves.
--
-- IDEMPOTENT: re-running adopts the existing auth user and re-asserts the
-- profile flags.
--
-- TO CHANGE THE ADMIN, edit the two values below and re-run.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_email text := 'muhammad.abdullah@kodexolabs.com';
  v_name  text := 'Muhammad Abdullah';
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    -- email_confirmed_at MUST be set. The app signs in with signInWithOtp and
    -- shouldCreateUser:false; an unconfirmed address is refused, and the login
    -- form cannot report it (§8 deliberately never branches on `error`), so it
    -- would surface only as "the magic link never works".
    -- confirmation_token / recovery_token / email_change_token_new /
    -- email_change MUST be '' and never NULL. They are nullable in the table
    -- and have no default, but GoTrue scans them into non-nullable Go strings —
    -- leave them NULL and every lookup fails with "Database error finding
    -- user", so the account exists, looks perfect in the dashboard, and simply
    -- cannot sign in. VERIFIED: with these four NULL, generateLink fails; with
    -- them empty, the full magic-link round trip succeeds.
    --
    -- encrypted_password stays NULL: this app is magic-link only and has no
    -- password flow at all.
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      created_at,
      updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_name),
      '',
      '',
      '',
      '',
      now(),
      now()
    );

    -- GoTrue resolves an email sign-in through auth.identities, not just
    -- auth.users. Without this row the magic link is requested against a user
    -- that lookup cannot find.
    --
    -- `id` is omitted (it defaults) and `email` MUST be omitted — it is a
    -- GENERATED ALWAYS column derived from identity_data, and naming it in the
    -- column list raises 428C9.
    insert into auth.identities (
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      v_user_id::text,
      v_user_id,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  -- Self-healing: repair a row created before the NULL-token issue was
  -- understood (or by any other hand-rolled SQL). Without this, re-running the
  -- seed would report success against an account that still cannot sign in.
  update auth.users set
    confirmation_token     = coalesce(confirmation_token, ''),
    recovery_token         = coalesce(recovery_token, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    email_change           = coalesce(email_change, ''),
    email_confirmed_at     = coalesce(email_confirmed_at, now())
  where id = v_user_id;

  -- is_super_admin short-circuits has_claim() to true, so this profile
  -- correctly ends up with ZERO rows in user_claims — the profiles_default_claims
  -- trigger skips super admins deliberately. Empty is not missing privileges.
  insert into public.profiles (id, email, name, is_active, is_super_admin)
  values (v_user_id, v_email, v_name, true, true)
  on conflict (id) do update set
    email          = excluded.email,
    name           = excluded.name,
    is_active      = true,
    is_super_admin = true,
    deleted_at     = null;

  raise notice 'Super admin ready: % (%)', v_email, v_user_id;
end $$;

-- Fails loudly if anything above silently did not take.
do $$
begin
  if not exists (
    select 1 from public.profiles
    where email = 'muhammad.abdullah@kodexolabs.com'
      and is_super_admin and is_active and deleted_at is null
  ) then
    raise exception 'Super admin was not created';
  end if;

  if not public.has_claim(
    (select id from public.profiles where email = 'muhammad.abdullah@kodexolabs.com'),
    'projects:view'
  ) then
    raise exception 'has_claim() did not return true for the super admin';
  end if;
end $$;
