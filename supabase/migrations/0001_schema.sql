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
