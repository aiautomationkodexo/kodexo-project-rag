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
-- Sections: 0001_schema.sql, 0002_rls.sql, 0003_taxonomy.sql, 0004_storage_realtime.sql, 0005_rpc.sql, 0006_soft_delete.sql, 0007_privilege_lockdown.sql, 0008_magic_link_throttle.sql, 0009_sweep_recovery.sql, 0010_media_size_cap.sql, 0011_tag_admin.sql, 0012_project_fields.sql, 0013_nda_status.sql, 0014_project_client.sql, 0015_project_links.sql, 0016_document_visibility.sql, 0017_project_outcomes.sql, 0100_super_admin.sql
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
--
-- TIMING INVARIANT — the 15 minutes below is the third term in:
--
--   TRANSCRIBE_TIMEOUT_MS (600s)  <  maxDuration (800s)  <  reclaim (900s)
--
-- The reclaim window MUST stay above the route's maxDuration, or a still-living
-- invocation's document becomes claimable and a second worker starts on it.
-- Two workers then race `delete chunks where document_id` against their own
-- inserts, which leaves a permanently duplicated chunk set — invisible except
-- as duplicate search snippets and double-weighted retrieval.
-- (0009's chunks_document_ordinal_idx makes that overlap fail loudly instead,
-- but it is a backstop, not a licence to shorten this interval.)
-- See src/app/api/process/[documentId]/route.ts and src/lib/ai/deepgram.ts.
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
-- ▶ supabase/migrations/0009_sweep_recovery.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0009 — Sweep recovery + storage lifecycle
--
-- Three things the cron sweep (PRD §13) cannot express through PostgREST, plus
-- one index that turns a silent corruption into a loud error.
--
-- ── DEFECT IN THE PRD (§13 step 3) ─────────────────────────────────────────
--
-- The PRD specifies deleting Storage objects "with no matching `documents`
-- row", and justifies it with: "Supabase Storage does not cascade from Postgres
-- deletes. Step 3 is required or deleted projects keep costing storage."
--
-- That rule does not do what that sentence says. `soft_delete_project`
-- (0006) only sets `deleted_at`; the `documents` rows survive, and NOTHING in
-- this codebase hard-deletes a project. So every object belonging to a deleted
-- project still HAS a matching documents row, and the rule as written sweeps
-- exactly none of them. Implemented literally, the leak it names stays open.
--
-- Two rules are needed, and they are different queries:
--
--   purgeable_projects  — soft-deleted past a retention window. The actual
--                         leak. Keyed on projects.deleted_at, not on row
--                         absence.
--   (abandoned uploads) — object with no documents row. Real, but a much
--                         narrower case: the user closed the tab between the
--                         upload finishing and the server action inserting the
--                         row. Driven from Storage, so it lives in the route,
--                         not here.
--
-- ── DEFECT: a project can strand in 'processing' forever ───────────────────
--
-- `maybeFinalize` runs inside the calling route's `after()`. If that invocation
-- dies before claim_finalize commits — killed at maxDuration, or the platform
-- reclaiming a frozen instance — the document is 'done' but the project stays
-- 'processing', and nothing retries it:
--
--   stuck_documents  selects DOCUMENTS; every one of them is already 'done'.
--   sweep step 2     unstrands 'finalizing' projects; this one never got there.
--
-- The project shows "processing" in the UI forever with no error anywhere.
-- Pre-existing, but near-unreachable while the longest document was a PDF. A
-- 600-second transcription (T7) makes it reachable, so it gets a recovery path:
-- stranded_projects feeds /api/finalize/{id}, which routes through
-- claim_finalize — §15.6 holds, there is still exactly one gate.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Chunk uniqueness ───────────────────────────────────────────────────────
--
-- NOT IN THE PRD. process_document does `delete chunks where document_id = ...`
-- then inserts, which is correct for one worker and silently wrong for two: the
-- interleaving B-deletes → A-inserts → B-inserts leaves a permanently duplicated
-- chunk set. Nothing surfaces it. The document reads 'done', the UI shows
-- nothing unusual, and the only symptom is duplicate search snippets and a
-- project that is double-weighted in retrieval forever.
--
-- Two workers should be impossible — claim_document is the gate, and
-- maxDuration (800s) < the reclaim window (900s) means the first invocation is
-- always dead before the row becomes claimable again. This index is what makes
-- that ordering FAIL LOUDLY if someone ever changes one of those numbers
-- without the other: the overlap becomes a 23505 on the existing transient
-- retry path instead of corruption nobody can see.
--
-- Existing duplicates are removed first, keeping the lowest id per (document,
-- ordinal). If any exist they are already corruption; the index cannot be
-- created while they remain.
delete from chunks c
using chunks keep
where c.document_id = keep.document_id
  and c.ordinal     = keep.ordinal
  and c.id          > keep.id;

create unique index if not exists chunks_document_ordinal_idx
  on chunks (document_id, ordinal);

-- ── Recovery: projects stranded in 'processing' ────────────────────────────
--
-- The mirror of claim_finalize's own pending count, and it must STAY a mirror:
-- `is_active` is in that count (0005 FIX), so a project whose only outstanding
-- document was deactivated is finalizable and belongs in this result.
--
-- PostgREST cannot express the `not exists`, which is why this is an RPC rather
-- than a query in the route.
--
-- No `attempts` ceiling, unlike stuck_documents. Re-finalizing is idempotent —
-- claim_finalize's conditional UPDATE means a project that already escaped
-- returns false and does nothing — so there is no runaway to bound. The
-- `limit` bounds the sweep's work per tick instead.
create or replace function stranded_projects(older_than_minutes int default 15)
returns table (id uuid)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select p.id
  from projects p
  where p.status = 'processing'
    and p.deleted_at is null
    and p.updated_at < now() - (older_than_minutes || ' minutes')::interval
    and not exists (
      select 1 from documents d
      where d.project_id = p.id
        and d.is_active
        and d.status in ('queued','processing'))
  limit 50;
$$;

-- ── Storage lifecycle: soft-deleted projects past retention ────────────────
--
-- Returns the object keys to remove, NOT the projects. The caller needs keys
-- for storage.remove() and document ids to null out storage_key afterwards, and
-- returning both in one round trip keeps the route from re-querying.
--
-- Rows are deliberately NOT deleted, here or by the caller: projects.created_by
-- / last_updated_by and the audit trail reference them, `raw_text` is §15.2's
-- re-chunk and model-migration path, and the summary is the record of what the
-- project WAS. Only the billable bytes go.
--
-- The 30-day default is the undelete grace period. It is a default rather than
-- a hardcoded interval so it can be tuned from the caller without a migration.
--
-- `storage_key is not null` excludes both synthetic documents (which never had
-- a file) and rows already purged by an earlier sweep — that second one is what
-- makes this converge instead of re-listing the same project every 5 minutes
-- forever.
create or replace function purgeable_projects(
  older_than_days int default 30,
  match_limit int default 200
)
returns table (project_id uuid, document_id uuid, storage_key text)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select d.project_id, d.id, d.storage_key
  from documents d
  join projects p on p.id = d.project_id
  where p.deleted_at is not null
    and p.deleted_at < now() - (older_than_days || ' days')::interval
    and d.storage_key is not null
  limit match_limit;
$$;

-- ── Abandoned-upload support ───────────────────────────────────────────────
--
-- Step 5 of the sweep walks Storage prefixes, which only the route can do. It
-- needs two things from Postgres: which projects are worth walking, and which
-- document ids under a project are legitimate.
--
-- Scoped to RECENT projects on purpose. An abandoned object is always created
-- within minutes of project activity — /api/upload-url mints the key during an
-- upload the user was, at that moment, actually performing — so a 24h window
-- catches essentially all of them while bounding a walk that would otherwise be
-- O(every project) on a 5-minute cron.
create or replace function recently_active_projects(
  within_hours int default 24,
  match_limit int default 20
)
returns table (id uuid)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select p.id
  from projects p
  where p.updated_at > now() - (within_hours || ' hours')::interval
  order by p.updated_at desc
  limit match_limit;
$$;

-- ── Execute grants ─────────────────────────────────────────────────────────
-- All four are sweep-only and read the whole table set without reference to
-- auth.uid(). service_role exclusively; without the revoke, Postgres' default
-- grant to PUBLIC would let any authenticated user enumerate deleted projects'
-- storage keys.
revoke execute on function stranded_projects(int), purgeable_projects(int, int),
  recently_active_projects(int, int) from public;
grant execute on function stranded_projects(int), purgeable_projects(int, int),
  recently_active_projects(int, int) to service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0010_media_size_cap.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0010 — Raise the per-file ceiling to 200 MB for T7 (audio/video)
--
-- A 10-minute 1080p MP4 is routinely 80-150 MB and the user has no way to
-- shrink one, so 0001's 50 MB ceiling made T7's own acceptance criterion
-- ("a 10-minute MP4 transcribes") unreachable with a real recording.
--
-- Raising it is safe specifically because the media path never buffers:
-- Deepgram is handed a signed Storage URL and fetches the bytes itself, so a
-- 200 MB video never passes through a function. The 50 MB limit was bounding
-- in-function parsing, and that argument does not apply here.
--
-- Raised HERE rather than by editing 0001 and 0004: both are recorded as
-- applied, so an edit to either is a no-op on every existing project.
--
-- ── FLAT, NOT MIME-AWARE ───────────────────────────────────────────────────
--
-- The per-type rule (50 MB documents / 200 MB media) lives in
-- src/lib/uploads/mime.ts, which is the only gate that runs BEFORE the bytes
-- move — enforced in the dropzone and re-enforced in /api/upload-url.
--
-- A mime-aware CHECK here would look like enforcement and not be any:
-- storage.buckets.file_size_limit is a single scalar and cannot express the
-- rule at all, so Storage would accept a 200 MB PDF regardless. The CHECK would
-- then reject the row AFTER 200 MB of bytes were already in the bucket,
-- producing an orphaned object (Storage does not cascade from Postgres — that
-- is what the sweep's step 4 exists for) plus a confusing action-level error.
--
-- And the value being checked is client-supplied: the create action JSON-parses
-- `size` off the request body into size_bytes and nothing ever stats the stored
-- object. This constraint is a sanity BOUND on a self-reported number, not the
-- policy. Encoding policy in it would be a category error.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── documents.size_bytes ───────────────────────────────────────────────────
--
-- A CHECK cannot be altered in place; it must be dropped and re-added.
--
-- The constraint 0001 created was auto-named. Discovering it by DEFINITION
-- rather than trusting the generated name makes this replay-safe against a
-- database that was hand-patched at any point — and the loop is a no-op if it
-- finds nothing, so a re-run cannot fail. The replacement is named EXPLICITLY
-- so the next change to it is deterministic.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.documents'::regclass
      and contype  = 'c'
      and pg_get_constraintdef(oid) ilike '%size_bytes%'
  loop
    execute format('alter table public.documents drop constraint %I', c);
  end loop;
end $$;

-- Validated against existing rows on ADD rather than NOT VALID: every existing
-- row already satisfies a strictly wider bound, so the scan cannot fail and
-- NOT VALID + VALIDATE would be ceremony.
alter table public.documents
  add constraint documents_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 209715200);

-- ── Bucket ─────────────────────────────────────────────────────────────────
--
-- Restated rather than edited into 0004, for the reason in the banner.
--
-- Same soft-fail wrapper as 0004 and for the same reason: `db push` stops at
-- the first error, so an unguarded privilege failure here would strand every
-- later migration. Every block downgrades a privilege error to a warning, which
-- is what makes SETUP.md's verification queries mandatory rather than optional.
--
-- ⚠ THE PLATFORM GLOBAL LIMIT CAPS THIS. Storage → Settings → global file size
--   limit must be >= 200 MB, or the bucket silently clamps: this row reads
--   209715200, `verify:cloud` passes, and 200 MB uploads still fail with an
--   opaque Storage error.
--
-- ⚠ supabase/config.toml MUST be kept in step. `npm run buckets:push` writes
--   that file through the Storage REST API and would put 50 MiB straight back
--   over this. Both are set to 200MiB in the same change.
do $$
begin
  update storage.buckets
     set file_size_limit = 209715200
   where id = 'project-files';
exception
  when insufficient_privilege then
    raise warning
      '0010: cannot update storage.buckets as %. Run: npm run buckets:push',
      current_user;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0011_tag_admin.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0011 — Tag approve / merge  (PRD §12 /admin/tags, T8)
--
-- Every finalize that meets an unrecognised technology name creates a tag with
-- is_approved = false (finalize-project.ts resolveTags). Until now nothing
-- could drain that queue, so the set only ever grew — and two spellings of one
-- technology ("Vertex AI", "Google Vertex AI") became two tags that split every
-- filtered search between them, permanently.
--
-- Five things, in dependency order:
--
--   1. tech_tag_alias_key(text) — the §7 normalisation rule, extracted. It has
--      existed in TWO places since 0003 (0003:51 in SQL, `aliasKey` in
--      src/lib/pipeline/finalize-project.ts in TS) with parity asserted only in
--      a comment. This makes SQL the definition and adds a CHECK that turns TS
--      drift into a loud 23514 instead of a silently unresolvable row.
--
--   2. A self-alias trigger, closing the window where resolveTags' two
--      non-atomic PostgREST calls leave a tag with no alias at all.
--
--   3. tags:manage — a real claim replacing is_super_admin() on tags_write /
--      aliases_write. NO data migration: has_claim() short-circuits on
--      is_super_admin (0001), so every existing super admin keeps working with
--      zero rows in user_claims. That property is why claims can be added at
--      all.
--
--   4. A verb/column lockdown, applying 0007's pattern to the newly-widened
--      principal set.
--
--   5. merge_tech_tag() — atomic, locked, and explicit about every row it
--      moves. The cascade is never asked to do the repointing.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. The alias-key rule, once ────────────────────────────────────────────
--
-- IMMUTABLE because a CHECK constraint requires it, and because it genuinely
-- is: lower() and regexp_replace() are both immutable, and Postgres builds
-- regex ranges by code point, so `[a-z]` is U+0061..U+007A regardless of the
-- database collation.
--
-- Verbatim the expression 0003 already used to derive every seeded self-alias.
-- Do NOT "improve" it to [[:alnum:]] — that is locale-dependent and would start
-- admitting accented characters, silently changing what resolves to what.
create or replace function tech_tag_alias_key(name text)
returns text language sql immutable strict parallel safe
set search_path = public, extensions, pg_temp as $$
  select regexp_replace(lower(name), '[^a-z0-9]', '', 'g');
$$;

comment on function tech_tag_alias_key(text) is
  'PRD §7 alias normalisation: lower(name) with non-alphanumerics stripped. '
  'THE definition. src/lib/pipeline/finalize-project.ts:aliasKey is a copy kept '
  'for the batched lookup; the CHECK on tech_tag_aliases is what stops the two '
  'from diverging silently.';

-- A non-normalised alias is not an error today — it is simply a row that can
-- never match, because resolveTags looks up by the normalised key. It fails as
-- ABSENCE, which is invisible: the symptom is a duplicate tag appearing in the
-- review queue weeks later. This makes it fail as an error instead.
--
-- NOT VALID deliberately: existing rows are not scanned, so this migration
-- cannot fail on a pre-0011 hand-written alias. Every INSERT and UPDATE from
-- here on IS checked, which is the part that matters. To finish the job:
--
--   select alias, tech_tag_id from tech_tag_aliases
--    where alias <> tech_tag_alias_key(alias);
--   alter table tech_tag_aliases validate constraint tech_tag_aliases_normalized;
alter table public.tech_tag_aliases
  drop constraint if exists tech_tag_aliases_normalized;

alter table public.tech_tag_aliases
  add constraint tech_tag_aliases_normalized
  check (alias = tech_tag_alias_key(alias)) not valid;


-- ── 2. Self-alias, maintained by the database ──────────────────────────────
--
-- resolveTags creates a tag and its alias in TWO non-atomic PostgREST calls.
-- If the second fails, the tag exists with no alias and is permanently
-- unresolvable — so the next finalize that sees the same spelling creates
-- ANOTHER duplicate. A tag inserted through PostgREST by a tags:manage holder
-- has the same problem from birth.
--
-- ON CONFLICT DO NOTHING, never DO UPDATE: a self-alias must never steal a key
-- that already resolves to a different tag. That overwrite is precisely the bug
-- that orphans tags (see the matching fix in finalize-project.ts).
--
-- SECURITY DEFINER for the same reason grant_default_claims (0001) is: an
-- after-insert trigger writing to a second RLS-protected table must not fail
-- because the inserting principal's claims differ between the two.
create or replace function tech_tags_sync_self_alias() returns trigger
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare k text;
begin
  k := tech_tag_alias_key(new.canonical_name);
  -- A symbol-only name ('++') keys to the empty string and would collide with
  -- every other symbol-only name. Skipped rather than rejected: raising here
  -- would throw inside finalize, whose catch forces status='ready' and
  -- discards the whole summary for that project (§15.9). A bad tag name must
  -- not cost a summary.
  if k = '' then return null; end if;

  insert into tech_tag_aliases (alias, tech_tag_id) values (k, new.id)
  on conflict (alias) do nothing;

  return null;
end;
$$;

drop trigger if exists tech_tags_self_alias on public.tech_tags;
create trigger tech_tags_self_alias
  after insert or update of canonical_name on public.tech_tags
  for each row execute function tech_tags_sync_self_alias();


-- ── 3. tags:manage replaces is_super_admin ─────────────────────────────────
--
-- Curating the taxonomy is ongoing work that grows with every finalize.
-- Gating it on is_super_admin meant the only way to delegate it was to hand
-- over user management, the audit log, and permanent bypass of every claim
-- check. This makes it a claim like any other.
--
-- DROP + CREATE rather than ALTER POLICY, to keep the full predicate visible in
-- one place the way 0002 writes them. Safe: policies are permissive, so a table
-- with none is default-DENY — the intermediate state fails closed, and
-- `db push` runs the migration in a transaction regardless.
--
-- The (select ...) wrapping is 0002's InitPlan hoist, correct to apply here
-- because neither predicate references a column of the row being written
-- (unlike claims_insert/claims_delete, which must NOT be hoisted).
--
-- user_claims.claim is free text with no FK or enum, so granting 'tags:manage'
-- needs no schema change. claims_insert's per-row guard ("you may only grant
-- what you hold") means a super admin mints the first one.
drop policy if exists tags_write on public.tech_tags;
create policy tags_write on public.tech_tags for all to authenticated
using ((select has_claim((select auth.uid()), 'tags:manage')))
with check ((select has_claim((select auth.uid()), 'tags:manage')));

drop policy if exists aliases_write on public.tech_tag_aliases;
create policy aliases_write on public.tech_tag_aliases for all to authenticated
using ((select has_claim((select auth.uid()), 'tags:manage')))
with check ((select has_claim((select auth.uid()), 'tags:manage')));


-- ── 4. Lockdown, per 0007 ──────────────────────────────────────────────────
--
-- `for all` gave the holder every verb on tech_tags, which was defensible when
-- the principal was the single most-trusted account. tags:manage is delegated,
-- and the same PostgREST request that approves a tag can do two other things
-- that fail silently:
--
--   PATCH ?id=eq.X {"canonical_name": "..."}
--     Renames the tag out from under its alias. More importantly, this revoke
--     is about the columns 0011 has not thought of yet — as in 0007, once
--     table UPDATE is revoked, every column a LATER migration adds is
--     un-writable through the API until someone deliberately grants it.
--
--   DELETE ?id=eq.X
--     Cascades through project_tech_tags and strips the tag from every project
--     that carried it, with no repointing and no record. That is exactly the
--     outcome merge_tech_tag exists to prevent, reachable in one request.
--     PRD §12 offers two actions, "approve, or merge into an existing tag" —
--     neither is a raw delete.
--
-- Order matters: Postgres cannot subtract a column from a table-level grant
-- (0007) — it emits a WARNING and changes nothing. Revoke the table privilege
-- first, then re-grant the one permitted column.
--
-- merge_tech_tag is SECURITY DEFINER and runs as the owner, so it is unaffected
-- by both revokes; the pipeline connects as service_role, also unaffected.
revoke update, delete on public.tech_tags from authenticated, anon;
grant update (is_approved) on public.tech_tags to authenticated;


-- ── 5. merge_tech_tag ──────────────────────────────────────────────────────
--
-- SECURITY DEFINER for 0006's reason, not for convenience: the merge writes
-- project_tech_tags, whose ptt_write policy demands 'projects:update'. A
-- tags-only curator holds tags:manage and need not hold that. So the write
-- escapes its own policy, and the function performs the claim check that
-- replaces it. Authorization stays in SQL.
--
-- Returns the number of projects repointed.
create or replace function merge_tech_tag(p_source uuid, p_target uuid)
returns int language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_source_name text;
  v_target_name text;
  v_key         text;
  v_key_owner   uuid;
  v_aliases     int;
  v_projects    int;
  v_shared      int;
begin
  -- FIRST, before any lock is taken: an unprivileged caller must not be able to
  -- block a legitimate merge, however briefly.
  if not has_claim((select auth.uid()), 'tags:manage') then
    raise exception 'Missing permission: tags:manage';
  end if;

  if p_source is null or p_target is null then
    raise exception 'merge_tech_tag: source and target are both required';
  end if;

  if p_source = p_target then
    raise exception 'Cannot merge a tech tag into itself';
  end if;

  -- ── THE LOCK, and the mode is load-bearing ───────────────────────────────
  -- Inserting into project_tech_tags runs an RI check that takes FOR KEY SHARE
  -- on the referenced tech_tags row, and FOR KEY SHARE conflicts with exactly
  -- one mode: FOR UPDATE. Holding it means no concurrent finalize can commit a
  -- project_tech_tags or tech_tag_aliases row pointing at EITHER tag while this
  -- merge runs.
  --
  -- Without it: a finalize inserts (P, source) after the repoint below and
  -- before the delete at the end, the cascade eats that row, and project P is
  -- left carrying NEITHER tag. Silent, and unattributable afterwards.
  --
  -- FOR NO KEY UPDATE reads as sufficient and is NOT — it does not conflict
  -- with FOR KEY SHARE, and the race above would stay wide open.
  --
  -- ORDER BY id gives a deterministic acquisition order, so merge(A,B) racing
  -- merge(B,A) serialises instead of deadlocking.
  perform 1 from tech_tags where id in (p_source, p_target) order by id for update;

  -- Read AFTER the lock, so these cannot be stale. canonical_name is NOT NULL,
  -- so `not found` is the only way these come back empty.
  select canonical_name into v_source_name from tech_tags where id = p_source;
  if not found then
    raise exception 'merge_tech_tag: source tech tag does not exist';
  end if;

  select canonical_name into v_target_name from tech_tags where id = p_target;
  if not found then
    raise exception 'merge_tech_tag: target tech tag does not exist';
  end if;

  -- ── Aliases ──────────────────────────────────────────────────────────────
  -- No conflict guard, and none is possible: tech_tag_aliases' PRIMARY KEY is
  -- `alias` ALONE (0001), so one alias cannot belong to two tags, and this
  -- statement changes only the non-key column. A `not exists` guard here would
  -- be dead code.
  update tech_tag_aliases set tech_tag_id = p_target where tech_tag_id = p_source;
  get diagnostics v_aliases = row_count;

  -- The source's own spelling must survive its tag, or the next finalize that
  -- meets that variant re-creates it as a fresh unapproved duplicate — which is
  -- the whole point of the feature (PRD §14 T8: "creates an alias so the same
  -- variant normalizes automatically next time").
  --
  -- Normalised HERE, in SQL, not passed in by the caller. An alias key is an
  -- unvalidatable string — any [a-z0-9]* value is syntactically legal — so a
  -- caller-supplied key that is subtly wrong produces a merge that reports
  -- success and silently normalises nothing.
  --
  -- Runs AFTER the repoint above, so if the source owned this key it is already
  -- on the target and the conflict is a no-op.
  --
  -- DO NOTHING, not DO UPDATE: if the key is held by a THIRD tag, that tag is
  -- already the destination for this spelling, and overwriting would strip its
  -- alias and could orphan it — the same failure this feature exists to clean
  -- up. v_key_owner records where the spelling actually landed.
  v_key := tech_tag_alias_key(v_source_name);
  if v_key <> '' then
    insert into tech_tag_aliases (alias, tech_tag_id) values (v_key, p_target)
    on conflict (alias) do nothing;
    select tech_tag_id into v_key_owner from tech_tag_aliases where alias = v_key;
  end if;

  -- ── Projects ─────────────────────────────────────────────────────────────
  -- Here the PK collision IS real: (project_id, tech_tag_id), and a project can
  -- legitimately carry both tags — commonly, because the duplicate spelling was
  -- emitted alongside the canonical one by the same extraction run. Repoint
  -- only where the target is absent.
  --
  -- The NOT EXISTS cannot race: no concurrent transaction can have committed a
  -- (project, target) row, because the FOR UPDATE above blocks its RI check.
  -- The UPDATE cannot self-collide either: every candidate row has
  -- tech_tag_id = p_source, so their project_ids are distinct by the PK.
  with moved as (
    update project_tech_tags ptt
       set tech_tag_id = p_target
     where ptt.tech_tag_id = p_source
       and not exists (select 1 from project_tech_tags dup
                        where dup.project_id = ptt.project_id
                          and dup.tech_tag_id = p_target)
    returning 1
  )
  select count(*) into v_projects from moved;

  -- The residue: projects that already carried both. Deleted EXPLICITLY rather
  -- than left to the cascade. Not a style preference — it means the DELETE
  -- below has nothing left to cascade to, so this function's correctness never
  -- depends on ON DELETE CASCADE doing something it was not asked to do, and a
  -- future change to that FK clause cannot silently alter what a merge does.
  delete from project_tech_tags where tech_tag_id = p_source;
  get diagnostics v_shared = row_count;

  -- LAST. Every referencing row has already been moved or removed by name.
  delete from tech_tags where id = p_source;

  -- T8's audit write. RLS on audit_log has a SELECT policy only; this lands
  -- because a definer function runs as the table owner. Atomic with the merge,
  -- which the TypeScript audit path cannot be.
  insert into audit_log (actor_id, action, entity_type, entity_id, meta)
  values ((select auth.uid()), 'tech_tag.merge', 'tech_tag', p_target,
          jsonb_build_object(
            'source_id',               p_source,
            'source_canonical_name',   v_source_name,
            'target_canonical_name',   v_target_name,
            'alias_key',               v_key,
            -- <> p_target means the source's spelling was already claimed by a
            -- third tag and was left alone. The merge is still correct; that
            -- spelling just does not route here yet.
            'alias_key_resolves_to',   v_key_owner,
            'aliases_repointed',       v_aliases,
            'projects_repointed',      v_projects,
            'projects_already_tagged', v_shared));

  return v_projects;
end;
$$;


-- ── Review queue, with usage counts ────────────────────────────────────────
--
-- A definer RPC rather than a PostgREST join, for two reasons. The count reads
-- project_tech_tags, whose ptt_select policy requires 'projects:view' — and a
-- tags-only curator need not hold it, so a plain join would return zeros rather
-- than an error. And it collapses what would otherwise be one count query per
-- tag.
--
-- Counts DISTINCT projects excluding soft-deleted ones: a queue that says
-- "4 projects" when three of them are deleted is worse than no number.
create or replace function unapproved_tag_usage()
returns table (
  id uuid,
  canonical_name text,
  created_at timestamptz,
  project_count bigint
)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not has_claim((select auth.uid()), 'tags:manage') then
    raise exception 'Missing permission: tags:manage';
  end if;

  return query
  select t.id, t.canonical_name, t.created_at,
         count(distinct p.id) as project_count
  from tech_tags t
  left join project_tech_tags ptt on ptt.tech_tag_id = t.id
  left join projects p on p.id = ptt.project_id and p.deleted_at is null
  where not t.is_approved
  group by t.id, t.canonical_name, t.created_at
  order by count(distinct p.id) desc, t.created_at asc;
end;
$$;


-- ── Execute grants ─────────────────────────────────────────────────────────
--
-- Revoking from public does not break the CHECK constraint or the trigger, for
-- 0001's reason: stored expressions are evaluated by the executor, not as
-- user-initiated function calls, so no EXECUTE check runs.
--
-- service_role is granted merge_tech_tag for symmetry with soft_delete_project,
-- with the same caveat: auth.uid() is null under service_role, so has_claim()
-- returns false and the guard rejects it. Reachable only from a session that
-- has set a JWT.
revoke execute on function tech_tag_alias_key(text), merge_tech_tag(uuid, uuid),
  unapproved_tag_usage(), tech_tags_sync_self_alias() from public;
grant execute on function tech_tag_alias_key(text), merge_tech_tag(uuid, uuid),
  unapproved_tag_usage() to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0012_project_fields.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 — Simple project fields
--
-- engagement_type, start_date, end_date, team_size.
--
-- CHECK constraints rather than Postgres enums, deliberately: adding a value to
-- an enum is a migration with locking implications, and every one of these
-- vocabularies is expected to change as the business changes. A CHECK is
-- rewritten by a plain ALTER.
--
-- Every column is NULLABLE with no default. There are existing rows, and none
-- of these facts can be inferred for them — a default would manufacture data
-- that nobody entered. "Unknown" is represented as NULL and rendered as "—".
-- ═══════════════════════════════════════════════════════════════════════════

alter table projects
  add column engagement_type text
    check (engagement_type is null or engagement_type in
      ('custom ai','automation','software product',
       'staff augmentation','consulting')),
  add column start_date date,
  add column end_date   date,
  add column team_size  int check (team_size is null or team_size > 0);

-- A table-level constraint, not a column CHECK: it references two columns.
-- Both NULL arms are required — a project with an end date but no start date is
-- legal (we may know when it shipped and not when it began), and Postgres
-- CHECKs pass on NULL anyway, so being explicit documents the intent.
alter table projects
  add constraint projects_date_order_check
  check (end_date is null or start_date is null or end_date >= start_date);

comment on column projects.engagement_type is
  'Commercial shape of the engagement. CHECK-constrained; see src/lib/types.ts.';
comment on column projects.team_size is
  'Headcount on the delivery team. NULL means unrecorded, never zero.';


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0013_nda_status.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0013 — NDA status
--
-- The full vocabulary is stored VERBATIM, including the awkward entries
-- ('Select', 'Needs Review'). This is a legal artifact: BD and legal need
-- their own words, and a tidied-up enum would force a lossy translation at
-- exactly the moment somebody needs to know what was actually agreed.
--
-- 'Select' is the unset placeholder the form ships with. It is deliberately a
-- real stored value rather than NULL-only, because "somebody opened the form
-- and did not choose" and "this project predates the field" are different
-- facts. BOTH resolve to non-disclosable — see disclosure() in
-- src/lib/projects/disclosure.ts, which fails closed on every value it does
-- not explicitly recognise.
--
-- NULLABLE with no default: existing rows have no NDA answer, and inventing
-- one would be a false legal record. NULL reads as "nobody has decided",
-- which behaves exactly like 'Permanently Excluded' until someone does.
-- ═══════════════════════════════════════════════════════════════════════════

alter table projects
  add column nda_status text
    check (nda_status is null or nda_status in (
      'Brand Name Use + Client Name Use',
      'Brand Name Use Only',
      'Client Name Use Only',
      'Nothing Can Be Used',
      'NDA Hold — Nothing Can Be Used',
      'Pending BD/Legal Clearance',
      'Permanently Excluded',
      'Internal Only — Never External',
      'Needs Review',
      'Select'
    ));

-- NOTE: the em dash in 'NDA Hold — Nothing Can Be Used' and
-- 'Internal Only — Never External' is U+2014, not a hyphen. The TS vocabulary
-- in src/lib/projects/disclosure.ts must match byte for byte or the CHECK
-- rejects a value the form just offered. tests/disclosure.test.mts asserts
-- the two lists agree.
comment on column projects.nda_status is
  'Disclosure terms, verbatim from the NDA. Interpreted ONLY through '
  'disclosure() in src/lib/projects/disclosure.ts, which fails closed.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Enforcement: a claim check in TypeScript is NOT enough here
--
-- `projects` carries Supabase's default table-level UPDATE grant to
-- `authenticated`, and 0007's column lockdown was applied ONLY to `profiles`.
-- So without the two layers below, ANY holder of projects:update can send
--
--   PATCH /rest/v1/projects?id=eq.<uuid>   {"nda_status": "Brand Name Use Only"}
--
-- with nothing but a session and the publishable key, and RLS approves it —
-- projects_update checks the claim, not the column. That is structurally the
-- same live privilege escalation 0007 closed for profiles.is_super_admin, and
-- an `assertClaim` in a Server Action does nothing about it: a Server Action is
-- one caller of the API, not a gate in front of it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Layer 1: column privileges ────────────────────────────────────────────
--
-- `revoke update (nda_status)` does NOT work — Postgres cannot subtract a
-- column from a table-level grant; it warns and changes nothing (0007:43).
-- The table grant must go, then the permitted columns come back individually.
--
-- ⚠ THIS IS FAIL-CLOSED AND IT IS ALSO A STANDING MAINTENANCE COST: after this
--   revoke, ANY column a later migration adds to `projects` is un-updatable by
--   `authenticated` until someone grants it here. That is 0007's documented
--   virtue — a forgotten column surfaces as a loud 42501 on save, never as a
--   silent write. The next person adding a projects column MUST return here.
revoke update on public.projects from authenticated, anon;

-- Every column an API caller may write, including 0012's four.
--
-- Deliberately NOT granted:
--   nda_status  — writable ONLY through set_nda_status() below.
--   id, created_by, created_at            — immutable.
--   updated_at  — owned by the projects_touch trigger. A BEFORE trigger's
--                 assignment to NEW needs no column privilege, because
--                 privileges are checked against the statement's SET list.
grant update (
  title, description, status, industry, industry_confidence,
  summary, summary_text, summary_embedding, last_updated_by, deleted_at,
  engagement_type, start_date, end_date, team_size
) on public.projects to authenticated;

-- ── Layer 2: the only write path ──────────────────────────────────────────
-- Same shape as soft_delete_project (0006): one write that must escape the
-- ordinary grant, routed through a definer function applying the check the
-- policy cannot express.
create or replace function set_nda_status(p_project uuid, p_status text)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  if not has_claim((select auth.uid()), 'projects:set-nda') then
    raise exception 'Missing permission: projects:set-nda';
  end if;

  -- Re-prove visibility. SECURITY DEFINER bypasses RLS, so without this the
  -- claim alone would let a holder set the status on ANY project by id —
  -- which is precisely soft_delete_project's original defect, reproduced in a
  -- brand-new function. Doing it here means per-project scoping only has to
  -- WIDEN this predicate later rather than discover it.
  if not exists (select 1 from projects
                 where id = p_project and deleted_at is null) then
    raise exception 'Project not found';
  end if;

  -- The CHECK constraint validates p_status for free: a bad value raises
  -- 23514 from inside the function, so there is no vocabulary list here to
  -- drift out of step with the column.
  update projects
     set nda_status = p_status,
         last_updated_by = (select auth.uid())
   where id = p_project;

  return found;
end;
$$;

revoke execute on function set_nda_status(uuid, text) from public;
grant execute on function set_nda_status(uuid, text) to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0014_project_client.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0014 — Client information
--
-- A SEPARATE TABLE, not a column on projects. RLS is ROW-level: there is no
-- policy that hides one column of a row you can otherwise read. The
-- alternative — column grants plus a definer read RPC, mirroring 0007 —
-- works, but it requires auditing every `select` in queries.ts forever and it
-- fails open when somebody adds a column list without thinking. A separate
-- table makes the leak structurally impossible: no policy, no rows.
--
-- §15.10 already bans select("*") in queries.ts, which helps. This makes even
-- a mistake there harmless.
--
-- ── NEVER ENTERS THE RAG ───────────────────────────────────────────────────
-- Nothing in this table is chunked, embedded, or written into summary_text.
-- The pipeline never reads it. See src/lib/pipeline/finalize-project.ts.
--
-- HONEST LIMITATION, stated so nobody over-claims: source documents still
-- contain the client's name in documents.raw_text and therefore in chunks.text
-- and the embeddings. Excluding the FIELD from the RAG does not scrub the
-- CORPUS. What holds is: the structured field is not retrievable; the prose
-- may still mention the client. True scrubbing (NER or a known-names pass) is
-- separate, larger work.
-- ═══════════════════════════════════════════════════════════════════════════

create table project_client (
  project_id  uuid primary key references projects(id) on delete cascade,
  client_name text,
  -- Room for contact, account manager, billing reference. Added when needed;
  -- an empty column is cheaper than a second migration to a used table.
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- MANDATORY. 0002's opening comment: Supabase's bootstrap grants
-- `authenticated` access to public tables, so a table created WITHOUT this is
-- readable by every signed-in user regardless of which policies exist.
alter table project_client enable row level security;

-- Both a select AND a write policy are required. Omitting the write policy
-- makes the table permanently read-only — RLS denies what no policy permits.
create policy project_client_select on project_client for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view-client-info')));

create policy project_client_write on project_client for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:view-client-info')))
with check ((select has_claim((select auth.uid()), 'projects:view-client-info')));

-- Reuses the trigger projects/documents/profiles already share (0001:257).
-- Without it updated_at is written once at insert and never again, which is a
-- silently stale audit trail on the one table whose edits are most sensitive.
create trigger project_client_touch before update on project_client
  for each row execute function touch_updated_at();

comment on table project_client is
  'Client identity, gated by projects:view-client-info. NEVER chunked, '
  'embedded, or written into summary_text. See 0014 header for the limits.';


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0015_project_links.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0015 — Project links
--
-- Reference URLs attached to a project: a live site, a repo, a case study.
--
-- `title` is nullable and NOT AI-populated. Filling it would require fetching
-- the URL server-side, which is an SSRF vector — a user-supplied URL fetched
-- by our server can reach internal addresses and cloud metadata endpoints.
-- Without a fetch the model has only the URL string, so any "title" it
-- produced would be plausible-sounding fiction. When title is absent the UI
-- displays the domain. If link fetching is ever wanted it needs an allowlist
-- and egress controls, and it should be its own decision.
--
-- Links are not extracted or embedded in v1, so a link is searchable on its
-- title only. Deliberate: the URL is a pointer, not content.
-- ═══════════════════════════════════════════════════════════════════════════

create table project_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  url         text not null check (length(trim(url)) > 0),
  title       text,
  description text,
  created_at  timestamptz not null default now()
);

create index project_links_project_idx on project_links (project_id);

alter table project_links enable row level security;

-- Mirrors the project policies: read with projects:view, write with
-- projects:update. Part A pairs these with scoped arms.
create policy links_select on project_links for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy links_write on project_links for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0016_document_visibility.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0016 — Document visibility
--
-- 'no_index' is the value with teeth: stored, never chunked, never embedded,
-- never retrieved.
--
-- ⚠ REVERSIBLE ONLY BECAUSE §15.2 PRESERVES raw_text. Flipping a document OUT
--   of no_index re-chunks from documents.raw_text; there is no other source —
--   storage_key is NULL for synthetic documents and the bucket object may
--   already have been purged by the 0009 sweep. This is the concrete payoff of
--   the "NEVER drop raw_text" invariant.
--
-- TWO VALUES, NOT FOUR. The proposal also listed 'internal' | 'public' |
-- 'on_request' as metadata for an MCP layer. There is no MCP server in this
-- repo, so those three would be stored, rendered in a <select>, and change
-- nothing — a control that implies an effect it does not have. Adding them
-- later is a drop-and-add of a NAMED constraint, which is the whole reason
-- this schema prefers CHECK over a Postgres enum.
--
-- DEFAULT 'indexed', NOT NULL. Every existing row is indexed today, so the
-- default IS the backfill and no UPDATE is needed. NOT NULL is load-bearing:
-- a nullable column makes `visibility <> 'no_index'` drop NULL rows under
-- SQL's three-valued logic, which would silently exclude every pre-existing
-- document from search — invisible in a small corpus, catastrophic later.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents
  add column if not exists visibility text not null default 'indexed';

alter table public.documents
  add constraint documents_visibility_check
  check (visibility in ('indexed', 'no_index'));

-- Partial index: the predicate both the pipeline and the search RPC filter on
-- is `visibility = 'no_index'`, and that set is expected to stay small — so
-- this is a few pages rather than one entry per document.
create index if not exists documents_no_index_idx
  on documents (project_id) where visibility = 'no_index';

comment on column public.documents.visibility is
  'indexed | no_index. no_index: raw_text kept, chunks deleted, pipeline skips '
  'chunk+embed, finalizeProject excludes it from the summariser corpus, and '
  'search_projects excludes its chunks. Reversible by re-queueing (§15.2).';

-- ═══════════════════════════════════════════════════════════════════════════
-- search_projects — excludes no_index documents
--
-- Reproduced from 0005 with TWO changes and nothing else: a `visible_docs`
-- CTE, and a join to it from both the vec and the fts arm. Every documented
-- decision in 0005 is preserved verbatim — RRF k=60, MAX-pooling via
-- DISTINCT ON, the unfloored FTS arm, the ordered FTS limit, ef_search=100.
--
-- BOTH arms must join it. Filtering only one leaves the document retrievable
-- through the other, which reads as an intermittent leak rather than a bug.
--
-- ── DEFENCE IN DEPTH, and both layers are required ────────────────────────
-- processDocument deletes the chunk set when a document goes no_index, so
-- this filter should normally find nothing to exclude. It exists because:
--   (i) a manual `update documents set visibility='no_index'` in the SQL
--       editor does NOT delete chunks, and that is a thing operators do;
--  (ii) if the delete path regresses, this is what keeps the guarantee true.
-- The chunk delete is what stops paying to store the embeddings; this filter
-- is what makes "never retrieved" hold when the delete did not run.
--
-- NOTE the interaction with `limit 60`: joining before the limit means the
-- HNSW candidate pool is consumed by the filter — the same recall concern
-- 0005:45-49 already documents for industry/tag filters, with the same
-- mitigation (ef_search=100). Fine at this corpus size; revisit with
-- pgvector 0.8's iterative_scan.
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- no_index documents are excluded from retrieval HERE, in one place.
  -- Filtering inside both the vec and fts CTEs would work but is two edits
  -- that must stay in step forever; a joined CTE is one.
  --
  -- ⚠ NOT `not in (select id from documents where visibility = 'no_index')`.
  --   NOT IN over a nullable subquery column yields NULL for every row the
  --   moment any value is NULL, which returns ZERO results silently.
  --   documents.visibility is NOT NULL so that is safe today, but the join
  --   form carries no such trap at all.
  visible_docs as (
    select d.id from documents d where d.visibility <> 'no_index'
  ),
  vec as (
    select c.id, c.project_id as pid, c.text, c.document_id,
           1 - (c.embedding <=> query_embedding) as sim,
           row_number() over (order by c.embedding <=> query_embedding) as rnk
    from chunks c
      join eligible e on e.id = c.project_id
      join visible_docs vd on vd.id = c.document_id
    where c.is_active and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit 60
  ),
  fts as (
    select c.id, c.project_id as pid, c.text, c.document_id,
           row_number() over (order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc) as rnk
    from chunks c
      join eligible e on e.id = c.project_id
      join visible_docs vd on vd.id = c.document_id
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


-- ═════════════════════════════════════════════════════════════════════════
-- ▶ supabase/migrations/0017_project_outcomes.sql
-- ═════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0017 — Features delivered and proof points
--
-- Two AI-extracted lists rendered on the project page, both derived from the
-- same corpus the summary is derived from.
--
-- FULL WIPE AND REBUILD on every finalize: delete every row for the project,
-- insert the freshly extracted set. That is safe ONLY because no row in
-- either table is human-authored — there is no editing UI, no is_reviewed
-- column and no approval workflow, deliberately. If an edit affordance is
-- ever added the wipe becomes destructive, and this paragraph is the warning.
--
-- Contrast §15.8, which forbids DELETING tech tags on regeneration: a tag is
-- shared vocabulary that a human curates through the 0011 approve/merge
-- queue, so losing one loses work. These rows are disposable model output
-- scoped to one project. Different data, different rule.
--
-- ── TWO TABLES, NOT ONE `kind` DISCRIMINATOR ──────────────────────────────
-- A shared table would force claim/metric/evidence_quote/source_document_id
-- all nullable so a feature row can leave them empty — converting four NOT
-- NULL guarantees into four application-level conventions, and turning
-- "a proof point must have a quote" into a conditional
-- `check (kind <> 'proof_point' or evidence_quote is not null)` that is easy
-- to get wrong and hard to read. Only proof points carry an FK, and its
-- `on delete` behaviour cannot be expressed per-kind in one table. The extra
-- boilerplate buys real constraints; take it.
--
-- ── CHILD TABLES, NOT `projects` COLUMNS ──────────────────────────────────
-- 0013 revoked the table-level UPDATE grant on `projects` and re-granted 14
-- named columns, so ANY new `projects` column is un-updatable by
-- `authenticated` (42501 on save) until someone returns to that grant list.
-- Child tables sidestep that standing cost entirely, and need NO `grant`
-- statement here at all — Supabase's bootstrap grant to `authenticated`
-- applies, exactly as project_links (0015) relies on.
--
-- ── NO NEW CLAIM ──────────────────────────────────────────────────────────
-- Read on projects:view, write on projects:update, mirroring project_links.
-- These are derived views of a corpus the reader can already see: anyone who
-- may read the summary these were extracted from may read these.
--
-- ── ⚠ THE NO-CLIENT-NAME RULE IS A MITIGATION, NOT A CONTROL ──────────────
--   The extraction prompt (OUTCOMES_SYSTEM rule 8) forbids naming any client,
--   customer, company or brand in any field, and requires attribution by
--   ROLE. That is a REQUEST TO A LANGUAGE MODEL, not a boundary.
--
--   The model receives documents.raw_text, which genuinely contains those
--   names, and evidence_quote is VERBATIM by design — so it is the highest-
--   risk field in this schema by construction. A leak is possible and nothing
--   in SQL detects or prevents one.
--
--   The structural guarantees elsewhere are unchanged and are NOT weakened:
--   project_client is still never read by finalizeProject, and
--   projects:view-client-info still gates the client name itself. What this
--   migration adds is a NEW surface where a name could appear as a side
--   effect of quoting. Treat these rows as exactly as trustworthy as the
--   corpus — no more.
--
--   Nothing here is chunked or embedded, so a leaked name does not enter the
--   vector index by this route. It is visible on the project page only.
--   No UI copy may describe these lists as anonymised.
-- ═══════════════════════════════════════════════════════════════════════════

create table project_features (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null constraint project_features_name_not_blank
                check (length(trim(name)) > 0),
  description text not null constraint project_features_description_not_blank
                check (length(trim(description)) > 0),
  -- Display order, taken from the model's array index at insert time.
  --
  -- NOT derivable from created_at, and that is the whole reason this column
  -- exists: a wipe-and-rebuild inserts every row in ONE statement, so now()
  -- is identical across all of them and `order by created_at` is genuinely
  -- non-deterministic — the same class of silent bug as the PRD's unordered
  -- `limit 60` in the FTS CTE (see 0005). The model emits these
  -- most-significant-first and that judgement survives nowhere else.
  ordinal     int not null constraint project_features_ordinal_non_negative
                check (ordinal >= 0),
  created_at  timestamptz not null default now(),
  -- Makes a duplicate-ordinal bug fail LOUDLY (23505 on insert) rather than
  -- silently returning rows in an arbitrary order.
  constraint project_features_project_ordinal_key unique (project_id, ordinal)
);

create index project_features_project_idx on project_features (project_id);

-- MANDATORY. Supabase's bootstrap grants `authenticated` access to public
-- tables, so a table created without this is readable by every signed-in user
-- regardless of which policies exist below.
alter table project_features enable row level security;

-- Mirrors the project policies, as project_links does: read with
-- projects:view, write with projects:update. Both arms use the
-- `(select has_claim((select auth.uid()), ...))` double-subquery form so the
-- planner hoists them into an InitPlan evaluated once per statement (0002).
create policy features_select on project_features for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy features_write on project_features for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

comment on table project_features is
  'AI-extracted list of what the project delivered. FULL WIPE AND REBUILD on '
  'every finalize — no row here is human-authored, so nothing is preserved. '
  'Rendered with a permanent "AI - Unreviewed" provenance badge; there is no '
  'review workflow and no is_reviewed column, deliberately. Adding an approve '
  'affordance would be a control with no effect: the next regenerate destroys '
  'these rows.';

comment on column project_features.ordinal is
  'Model-emitted display order, 0-based and gapless. Read paths MUST '
  'order by ordinal — created_at is identical across a batch insert and '
  'cannot order these.';

create table project_proof_points (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  -- The quantified outcome, stated as a claim.
  claim               text not null
                        constraint project_proof_points_claim_not_blank
                        check (length(trim(claim)) > 0),
  -- The isolated figure ('11 minutes to under 2', '310 drivers').
  --
  -- Nullable on purpose: a genuine proof point can be qualitative, and a NOT
  -- NULL here would be an instruction to the model to invent a number for
  -- every entry. Prompt rule 5 says null rather than fabricate; the schema
  -- has to permit that or the rule is unfollowable.
  metric              text,
  -- VERBATIM from the corpus. This is what makes a proof point checkable
  -- rather than an assertion — and it is the single highest-risk field in
  -- this schema for an unredacted client name. See the header.
  evidence_quote      text not null
                        constraint project_proof_points_quote_not_blank
                        check (length(trim(evidence_quote)) > 0),
  -- Which document the quote came from.
  --
  -- ON DELETE SET NULL, NOT CASCADE. The quote is stored here verbatim, so a
  -- proof point survives its source document's hard deletion with only its
  -- attribution degraded. CASCADE would let the 0009 sweep silently destroy
  -- extracted claims when it purges a deleted project's documents — data loss
  -- disguised as referential tidiness.
  --
  -- DEACTIVATION (is_active = false) does not touch this FK at all: the row
  -- keeps pointing at a now-inactive document until the re-summary that the
  -- deactivation triggers wipes and rebuilds these rows from a corpus that
  -- excludes it. There is therefore a real window where this resolves to a
  -- document the project no longer shows, so read paths MUST tolerate a
  -- source that resolves to nothing renderable and omit the attribution
  -- rather than assuming a filename.
  source_document_id  uuid references documents(id) on delete set null,
  ordinal             int not null
                        constraint project_proof_points_ordinal_non_negative
                        check (ordinal >= 0),
  created_at          timestamptz not null default now(),
  constraint project_proof_points_project_ordinal_key
    unique (project_id, ordinal)
);

create index project_proof_points_project_idx
  on project_proof_points (project_id);

-- The FK's own index. Postgres does NOT create one for a REFERENCING column,
-- and without it every `delete from documents` takes a seqscan of this table
-- per row deleted — which the 0009 sweep does in batches of 100.
create index project_proof_points_document_idx
  on project_proof_points (source_document_id);

alter table project_proof_points enable row level security;

create policy proof_points_select on project_proof_points
for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy proof_points_write on project_proof_points
for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

comment on table project_proof_points is
  'AI-extracted quantified outcomes, each carrying a verbatim evidence quote. '
  'FULL WIPE AND REBUILD on every finalize. The extraction prompt forbids '
  'naming any client, company or brand and requires attribution by role — '
  'that is a MITIGATION, NOT A CONTROL: raw_text contains those names and '
  'nothing here detects a leak. Never chunked, never embedded.';

comment on column project_proof_points.evidence_quote is
  'Verbatim corpus text. Highest-risk field in this schema for an unredacted '
  'client name; the prompt rule is a request to a model, not a boundary.';

comment on column project_proof_points.source_document_id is
  'Nullable, ON DELETE SET NULL. Null means the source was hard-deleted or a '
  'model-reported filename matched nothing. Render without attribution — '
  'never assume it resolves.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Document removal needs NO SQL, and that was verified rather than assumed.
--
-- soft_delete_project (0006) MUST be an RPC because projects_select filters
-- `deleted_at is null` and Postgres checks an UPDATE's NEW row against the
-- SELECT policy — so writing deleted_at makes the row invisible to its own
-- writer and raises "new row violates row-level security policy".
--
-- documents_select (0002) filters ONLY on the claim, NOT on is_active —
-- contrast chunks_select, which does filter it. So writing
-- documents.is_active = false leaves the NEW row visible to its writer and a
-- plain UPDATE succeeds. `documents` also has no column-grant lockdown
-- (0007/0011/0013 locked down profiles, tech_tags and projects only), so
-- documents_update's projects:update check is the whole authorization story.
--
-- Do NOT add an RPC for setDocumentActive. It would be ceremony that implies
-- the 0006 trap applies here, which it does not.
-- ═══════════════════════════════════════════════════════════════════════════


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
