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
