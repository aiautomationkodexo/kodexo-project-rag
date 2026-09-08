-- ═══════════════════════════════════════════════════════════════════════════
-- 0018 — Per-project scoped access
--
-- Adds ONE new access path to project data: an explicit grant row. Access
-- becomes "global claim OR grant row", OR'd by Postgres's own permissive
-- policy semantics. That is TWO paths and it is the maximum — do not add a
-- third. In particular do NOT add implicit ownership access (`created_by =
-- auth.uid()` silently conferring rights) even though the column exists and it
-- looks free: three paths to one permission is how a system becomes
-- unauditable, and an ownership rule would retroactively widen access for
-- every project already in the database. If ownership should confer access,
-- write a real grant row at create time — explicit, revocable, auditable.
--
-- ── THE SHAPE INVARIANT — the single most important thing in this file ─────
--
--   every scoped arm is
--     <col> in (select project_id from project_grants
--               where user_id = (select auth.uid()) and claim = '<c>')
--
--   It is `in (...)`, NEVER `exists (...)`. An EXISTS body referencing the
--   outer row (g.project_id = projects.id) is CORRELATED, and inside a
--   security qual Postgres frequently declines to pull it up into a semi-join:
--   it degrades to a per-row SubPlan and abandons the index. The `in (...)`
--   form contains NO reference to the outer row, so it is evaluated once,
--   hashed, then probed per row.
--
--   If somebody later "tidies" one of these into an EXISTS, the query stays
--   CORRECT and gets roughly a thousand times slower. That is the failure
--   mode: silent. SETUP.md has the EXPLAIN signature that catches it.
--
-- ── WHY TWO POLICIES RATHER THAN ONE WITH AN OR ───────────────────────────
-- 0002's header explains that a row-INDEPENDENT expression wrapped as
-- `(select has_claim(...))` is hoisted into an InitPlan evaluated once per
-- statement — "worth 10-100x on list queries". A scoped check references the
-- candidate row and therefore CANNOT be hoisted; that is structural, not a
-- tuning problem. Splitting the arms keeps the common case (a global claim
-- holder) on the hoisted path and confines the join to users who actually hold
-- grants. Postgres OR's permissive policies for free, so semantics are equal.
--
-- This shape is already precedent here: profiles_update_self and
-- profiles_update_admin (0002) are two permissive policies on the same table
-- and command, OR'd.
--
-- ── NO DENY PRIMITIVE, DELIBERATELY ───────────────────────────────────────
-- Grants are purely additive: adding a row can never remove anyone's access.
-- That is what makes this rollout risk-free and makes "what can this user
-- reach?" a plain union rather than an ordered evaluation. Do NOT add a
-- restrictive policy for scoping — it would forfeit that guarantee. The cost
-- is that "everything except project X" is inexpressible; that is the right
-- trade for an internal tool audited by people.
--
-- ── FACTORING THE SUBQUERY OUT INTO A HELPER WOULD DEFEAT IT ──────────────
-- A set-returning `granted_projects(uid, claim)` reads better and is wrong:
-- the planner cannot see inside it to use project_grants_user_claim_idx, and
-- cannot hash the result the way it hashes an inlined `in (select ...)`. The
-- literal subquery must appear in the policy text. The repetition below is the
-- price of the index.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists project_grants (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  claim      text not null,
  -- Advisory provenance only. It is client-supplied and unconstrained (a
  -- `with check (granted_by = auth.uid())` arm would block service_role seed
  -- rows), so audit_log is the authoritative record of who granted what.
  granted_by uuid references profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id, claim),

  -- A DELIBERATE DIVERGENCE from user_claims, which carries no such CHECK.
  --
  -- A junk row in user_claims grants nothing: no has_claim() call ever asks
  -- for a malformed claim. A junk row HERE also grants nothing, but it *looks
  -- like a deliberate grant in an audit*, and this table's whole value is that
  -- "who can reach this project?" is answered by LOOKUP. A lookup returning
  -- unenforced rows breaks precisely that property.
  --
  -- projects:create is absent because it is meaningless — a grant names an
  -- existing project, so scoping the right to create a NEW one to a project
  -- that already exists says nothing. projects:create stays portfolio-wide.
  --
  -- projects:delete is absent BY DECISION, not oversight. It is the highest
  -- blast-radius claim and soft_delete_project was the worst pre-existing gap
  -- in this schema. Delete stays global; see soft_delete_project below.
  constraint project_grants_claim_check check (
    claim in ('projects:view', 'projects:update')
  )
);

-- user_id LEADS. It is the constant in every scoped arm (the hoisted
-- auth.uid()), so the planner seeks one user's contiguous slice and can serve
-- the subquery index-only. Mirrors user_claims' (user_id, claim) PK ordering.
--
-- NOT served by the PK, whose leading column is project_id: that index answers
-- "who can see project X?" (the audit question) and cannot answer "which
-- projects can user U see?" (the hot question on every list render).
create index if not exists project_grants_user_claim_idx
  on project_grants (user_id, claim, project_id);

alter table project_grants enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- may_grant_on_project — "may you administer this project's access?"
--
-- SECURITY DEFINER for the same reason has_claim is (0001): it reads
-- project_grants, and a policy ON project_grants whose expression reads
-- project_grants re-triggers RLS on the inner read and raises
--   42P17 infinite recursion detected in policy for relation "project_grants"
-- Definer rights break the cycle.
--
-- DELIBERATELY NOT TRANSITIVE. Being a grantee does not make you a granter —
-- the users:update arm of grants_insert is a separate, non-delegable
-- requirement. If this became "any grantee may re-grant", then "who can reach
-- project P?" stops being a lookup and becomes a graph traversal, which is the
-- one property this design is staked on.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function may_grant_on_project(uid uuid, p_project uuid)
returns boolean language sql stable security definer parallel safe
set search_path = public, extensions, pg_temp as $$
  select is_active_user(uid)
    and exists (select 1 from projects p
                 where p.id = p_project and p.deleted_at is null)
    and (
      -- has_claim short-circuits on is_super_admin, so a super admin passes
      -- here with ZERO rows in either claim table — correct, and the reason
      -- every scope rule must sit BELOW that short-circuit.
      has_claim(uid, 'projects:view')
      or exists (select 1 from project_grants g
                  where g.user_id = uid
                    and g.project_id = p_project
                    and g.claim = 'projects:view')
    );
$$;

revoke execute on function may_grant_on_project(uuid, uuid) from public;
grant execute on function may_grant_on_project(uuid, uuid)
  to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- project_grants RLS
--
-- Mirrors user_claims (0002) deliberately, INCLUDING which arms are wrapped in
-- a scalar subquery and which are not:
--
--   HOISTED   (select has_claim((select auth.uid()), 'users:update'))
--             row-independent, so the planner lifts it into an InitPlan.
--
--   PER-ROW   has_claim((select auth.uid()), claim)
--             may_grant_on_project((select auth.uid()), project_id)
--             BOTH reference the row being written. Wrapping either in a
--             scalar subquery would evaluate it ONCE against an arbitrary row
--             and DEFEAT THE GUARD. 0002 says this in the same words.
--
-- The inner (select auth.uid()) is always safe to wrap; only the outer call
-- must stay per-row.
-- ═══════════════════════════════════════════════════════════════════════════

-- Your own grants, or an admin's view. NOTE what is deliberately absent:
-- "grants on projects I can see" — that would let a scoped grantee enumerate
-- their co-grantees, a membership disclosure nobody asked for.
create policy grants_select_self on project_grants for select to authenticated
using (user_id = (select auth.uid()));

create policy grants_select_admin on project_grants for select to authenticated
using ((select has_claim((select auth.uid()), 'users:view')));

-- THREE conjuncts, all load-bearing:
--   1. users:update           the same gate as granting a flat claim. HOISTED.
--   2. has_claim(claim)       cannot grant what you do not hold. PER-ROW.
--   3. may_grant_on_project   cannot grant on a project you cannot see.
--                             PER-ROW. No analogue in claims_insert, because a
--                             flat claim names no resource.
--
-- Conjunct 2 uses has_claim and NOT "has_claim OR holds a grant of that claim
-- on this project". That is the anti-delegation rule: a scoped editor of
-- project P cannot make someone else a scoped editor of P. Granting authority
-- is portfolio-level, held only by users:update holders.
create policy grants_insert on project_grants for insert to authenticated
with check ((select has_claim((select auth.uid()), 'users:update'))
            and has_claim((select auth.uid()), claim)
            and may_grant_on_project((select auth.uid()), project_id));

-- Same shape, ONE deliberate asymmetry: may_grant_on_project is NOT required.
--
-- REVOCATION MUST NEVER BE HARDER THAN GRANTING. may_grant_on_project checks
-- deleted_at, so requiring it here would make a grant on a soft-deleted
-- project UNREMOVABLE, and an administrator whose own visibility narrows would
-- lose the ability to clean up grants they themselves made. Since the model
-- has no deny primitive, removing a row can only ever REDUCE access — so a
-- laxer gate on DELETE is safe in the direction that matters.
create policy grants_delete on project_grants for delete to authenticated
using ((select has_claim((select auth.uid()), 'users:update'))
       and has_claim((select auth.uid()), claim));

-- No UPDATE policy: every column is part of the PK or is provenance.
-- "Changing" a grant is revoke + grant, which leaves two audit rows rather
-- than one silently-mutated one.
--
-- The privilege is revoked too, not left to RLS alone — following 0007 and
-- 0011: a privilege error (42501) fires BEFORE any row is touched, and a
-- revoked table-level UPDATE FAILS CLOSED for columns added by later
-- migrations.
revoke update on public.project_grants from authenticated, anon;

-- TRUNCATE IS NOT SUBJECT TO ROW SECURITY (same reasoning as 0007). One
-- statement would silently revoke every scoped user's access at once. Free
-- revoke, total blast radius.
revoke truncate on public.project_grants from authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- The paired policies
--
-- Each existing policy is dropped and recreated as `<name>_global` with its
-- expression UNCHANGED, then a `<name>_scoped` twin is added. Renaming rather
-- than leaving the old name is deliberate: `projects_select` next to
-- `projects_select_scoped` reads as though one is the real one, and a grep for
-- pairs is how this stays reviewable.
--
-- Existing users keep EXACTLY today's access — the global arm is byte-for-byte
-- what it was, and the scoped arm matches nothing while the table is empty.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── projects ───────────────────────────────────────────────────────────────

drop policy if exists projects_select on projects;

create policy projects_select_global on projects for select to authenticated
using (deleted_at is null
       and (select has_claim((select auth.uid()), 'projects:view')));

create policy projects_select_scoped on projects for select to authenticated
using (deleted_at is null
       and id in (select project_id from project_grants
                  where user_id = (select auth.uid())
                    and claim = 'projects:view'));

-- projects_insert is DELIBERATELY UNPAIRED and left untouched. A row that does
-- not exist yet cannot be in anyone's grant set, so there is no scoped arm to
-- write; projects:create is portfolio-wide by construction.

drop policy if exists projects_update on projects;

create policy projects_update_global on projects for update to authenticated
using (deleted_at is null
       and (select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

-- NOTE on the WITH CHECK arm: `id` is not updatable in practice, so the
-- post-image satisfies the same subquery as the pre-image. Postgres ALSO
-- checks the NEW row against the SELECT policies during an UPDATE — exactly
-- the mechanism 0006 documents for deleted_at — and both hold here because the
-- scoped SELECT arm admits the post-image too. If a future migration ever
-- makes projects.id mutable, revisit this.
create policy projects_update_scoped on projects for update to authenticated
using (deleted_at is null
       and id in (select project_id from project_grants
                  where user_id = (select auth.uid())
                    and claim = 'projects:update'))
with check (id in (select project_id from project_grants
                   where user_id = (select auth.uid())
                     and claim = 'projects:update'));

-- projects_delete: left GLOBAL-ONLY, and renamed for consistency with its
-- siblings. project_grants cannot carry projects:delete (see the CHECK), so
-- there is no scoped arm by design.
drop policy if exists projects_delete on projects;

create policy projects_delete_global on projects for delete to authenticated
using ((select has_claim((select auth.uid()), 'projects:delete')));

-- ── project_tech_tags ──────────────────────────────────────────────────────

drop policy if exists ptt_select on project_tech_tags;

create policy ptt_select_global on project_tech_tags for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy ptt_select_scoped on project_tech_tags for select to authenticated
using (project_id in (select project_id from project_grants
                      where user_id = (select auth.uid())
                        and claim = 'projects:view'));

-- ptt_write was FOR ALL, which silently made it a SELECT policy too (OR'd with
-- ptt_select). Kept as FOR ALL to preserve behaviour exactly, but note the
-- consequence, now explicit rather than accidental: the scoped twin therefore
-- also confers READ on a projects:update grant. That is coherent — you cannot
-- edit tags you cannot see — but it should be a decision, not a surprise.
drop policy if exists ptt_write on project_tech_tags;

create policy ptt_write_global on project_tech_tags for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

create policy ptt_write_scoped on project_tech_tags for all to authenticated
using (project_id in (select project_id from project_grants
                      where user_id = (select auth.uid())
                        and claim = 'projects:update'))
with check (project_id in (select project_id from project_grants
                           where user_id = (select auth.uid())
                             and claim = 'projects:update'));

-- ── project_summaries ──────────────────────────────────────────────────────

drop policy if exists summaries_select on project_summaries;

create policy summaries_select_global on project_summaries
for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy summaries_select_scoped on project_summaries
for select to authenticated
using (project_id in (select project_id from project_grants
                      where user_id = (select auth.uid())
                        and claim = 'projects:view'));

-- ── documents ──────────────────────────────────────────────────────────────

drop policy if exists documents_select on documents;

create policy documents_select_global on documents for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy documents_select_scoped on documents for select to authenticated
using (project_id in (select project_id from project_grants
                      where user_id = (select auth.uid())
                        and claim = 'projects:view'));

-- The `update OR create` disjunction from 0002 is preserved in the global arm.
-- Rationale for keeping projects:create there: createProject inserts the
-- synthetic description document into a project it has just created, holding
-- projects:create and not necessarily projects:update.
--
-- THE SCOPED ARM DELIBERATELY OMITS A create BRANCH. A grant can only name an
-- existing project, so a scoped projects:create is meaningless; a scoped user
-- creating a project enters through the global arm.
drop policy if exists documents_insert on documents;

create policy documents_insert_global on documents for insert to authenticated
with check ((select has_claim((select auth.uid()), 'projects:update'))
            or (select has_claim((select auth.uid()), 'projects:create')));

create policy documents_insert_scoped on documents for insert to authenticated
with check (project_id in (select project_id from project_grants
                           where user_id = (select auth.uid())
                             and claim = 'projects:update'));

drop policy if exists documents_update on documents;

create policy documents_update_global on documents for update to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

create policy documents_update_scoped on documents for update to authenticated
using (project_id in (select project_id from project_grants
                      where user_id = (select auth.uid())
                        and claim = 'projects:update'))
with check (project_id in (select project_id from project_grants
                           where user_id = (select auth.uid())
                             and claim = 'projects:update'));

-- Global-only, matching projects_delete: grants cannot carry projects:delete.
drop policy if exists documents_delete on documents;

create policy documents_delete_global on documents for delete to authenticated
using ((select has_claim((select auth.uid()), 'projects:delete')));

-- ── chunks ─────────────────────────────────────────────────────────────────
-- Read-only to clients; writes are service_role, which bypasses RLS. So there
-- is no write-side arm here at all.
--
-- `is_active` is repeated in BOTH arms rather than hoisted into a restrictive
-- policy, because a restrictive policy would forfeit the purely-additive
-- property this whole design rests on. Duplicating one boolean is cheaper.

drop policy if exists chunks_select on chunks;

create policy chunks_select_global on chunks for select to authenticated
using (is_active
       and (select has_claim((select auth.uid()), 'projects:view')));

create policy chunks_select_scoped on chunks for select to authenticated
using (is_active
       and project_id in (select project_id from project_grants
                          where user_id = (select auth.uid())
                            and claim = 'projects:view'));

-- ── project_links and project_client (0014 / 0015) ─────────────────────────
-- project_links is a project child and gets the same treatment.
--
-- project_client is NOT paired: it is gated on projects:view-client-info,
-- which project_grants cannot carry (see the CHECK). Client identity is a
-- portfolio-level trust decision, not a per-project one — a scoped grant on
-- one project must not confer client visibility anywhere.

drop policy if exists links_select on project_links;

create policy links_select_global on project_links for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy links_select_scoped on project_links for select to authenticated
using (project_id in (select project_id from project_grants
                      where user_id = (select auth.uid())
                        and claim = 'projects:view'));

drop policy if exists links_write on project_links;

create policy links_write_global on project_links for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

create policy links_write_scoped on project_links for all to authenticated
using (project_id in (select project_id from project_grants
                      where user_id = (select auth.uid())
                        and claim = 'projects:update'))
with check (project_id in (select project_id from project_grants
                           where user_id = (select auth.uid())
                             and claim = 'projects:update'));

-- ═══════════════════════════════════════════════════════════════════════════
-- soft_delete_project — SCOPED
--
-- THIS WAS THE WORST PRE-EXISTING GAP IN THE SCHEMA. The function is SECURITY
-- DEFINER, so RLS does not apply inside it, and the old body checked only the
-- BARE claim before `update projects ... where id = p_project`. Under scoping
-- that would mean a grant of any project claim conferred the right to delete
-- EVERY project, by id, with a single .rpc() call.
--
-- project_grants cannot carry projects:delete, so the bare global check below
-- remains the correct predicate — it is exactly what projects_delete_global
-- decides. The is_active_user arm is what makes that faithful rather than
-- merely similar.
--
-- ⚠ IF projects:delete IS EVER ADDED TO project_grants_claim_check, THIS
--   FUNCTION MUST GAIN THE SCOPED ARM IN THE SAME MIGRATION. A definer
--   function that escapes a policy must re-apply that policy; RLS will not
--   save you in here.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function soft_delete_project(p_project uuid)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- has_claim() already folds in is_active_user and short-circuits on
  -- is_super_admin. Unchanged in effect from 0006; restated with the uid in a
  -- local so the scoped arm can be added here without restructuring.
  if not has_claim(v_uid, 'projects:delete') then
    raise exception 'Missing permission: projects:delete';
  end if;

  update projects
     set deleted_at = now()
   where id = p_project
     and deleted_at is null;

  return found;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- set_nda_status — teach it the scope rule (0013)
--
-- Its visibility check was `exists (select 1 from projects where id = ...)`,
-- which is deliberately NOT RLS-dependent because a definer function bypasses
-- RLS anyway. Under scoping that predicate is now too NARROW in one direction
-- and too wide in another, so it becomes the same two-arm test as everywhere
-- else. projects:set-nda itself stays a GLOBAL claim: disclosure terms are a
-- legal determination, and a per-project editor must not acquire disclosure
-- authority along with edit rights.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function set_nda_status(p_project uuid, p_status text)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not has_claim(v_uid, 'projects:set-nda') then
    raise exception 'Missing permission: projects:set-nda';
  end if;

  -- The two-arm visibility test. may_grant_on_project already encodes exactly
  -- "global projects:view OR a view grant on this project", plus the
  -- deleted_at and is_active_user checks, so it is reused rather than
  -- restated — one definition of "can this person see this project".
  if not may_grant_on_project(v_uid, p_project) then
    raise exception 'Project not found';
  end if;

  update projects
     set nda_status = p_status,
         last_updated_by = v_uid
   where id = p_project;

  return found;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- search_projects — SCOPED. Discharges the STANDING INVARIANT at 0005:33-43,
-- which said in as many words: "if per-project visibility is ever introduced,
-- this function leaks every project to anyone holding projects:view until the
-- `eligible` CTE is taught the same rule. RLS will not save you inside a
-- definer function."
--
-- TWO changes, and BOTH are required. Doing only one is worse than doing
-- neither, in opposite directions:
--
--   1. THE ENTRY GUARD demanded the global claim. A user holding only grants
--      would be rejected outright — search would report "no permission" for
--      projects they can see listed on /projects.
--
--   2. THE `eligible` CTE is the actual leak the invariant names. Loosen the
--      guard without scoping the CTE and every scoped user gets the whole
--      portfolio.
--
-- Inside plpgsql the two-policy trick is unavailable, so the CTE arm is an OR
-- by necessity. It is still uncorrelated: the subquery references only
-- v_uid, never `p`.
--
-- v_global is computed once into a local, so when it is true the planner sees
-- a constant-true OR and never touches project_grants at all.
--
-- The visible_docs join from 0016 is preserved verbatim.
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
declare
  v_uid    uuid    := (select auth.uid());
  v_global boolean := has_claim(v_uid, 'projects:view');
  v_scoped boolean;
begin
  -- is_active_user() is REQUIRED here and is not redundant. has_claim() gates
  -- on it internally, but this arm never calls has_claim — so without it a
  -- DEACTIVATED or soft-deleted user holding a grant row could still search.
  -- The profiles FK is ON DELETE CASCADE, which only fires on a HARD delete,
  -- and this system soft-deletes users.
  --
  -- This is the first authorization test in the schema that does not route
  -- through has_claim, and therefore the first where "is this user still
  -- active?" has to be written by hand. Any future scoped definer arm needs
  -- the same line.
  v_scoped := is_active_user(v_uid) and exists (
    select 1 from project_grants
     where user_id = v_uid and claim = 'projects:view'
  );

  if not (v_global or v_scoped) then
    raise exception 'Missing permission: projects:view';
  end if;

  -- Widen the HNSW candidate pool. 0005 already warns that `vec` joins
  -- `eligible` AFTER the ANN scan, so a selective filter can collapse the
  -- top-N to near zero eligible rows.
  --
  -- ⚠ SCOPING MAKES THAT ACUTE, and it is the most likely user-visible
  --   regression here: a user granted 3 of 500 projects has `eligible` select
  --   ~0.6% of rows, and the HNSW top-60 will frequently contain NONE of their
  --   chunks — search returns empty even though their projects match well.
  --   ef_search is therefore raised much higher for a grants-only user, where
  --   the eligible set is small and the extra work is cheap. The real fix is
  --   pgvector 0.8's hnsw.iterative_scan = 'relaxed_order'.
  perform set_config('hnsw.ef_search',
                     case when v_global then '100' else '500' end, true);

  return query
  with eligible as (
    select p.id from projects p
    where p.deleted_at is null
      -- THE SCOPE RULE. v_global is a plpgsql local, so when it is true the
      -- planner sees a constant-true OR and never touches project_grants.
      and (v_global
           or p.id in (select project_id from project_grants
                       where user_id = v_uid and claim = 'projects:view'))
      and (filter_industry is null or p.industry = filter_industry)
      and (filter_tags is null or not exists (
        select 1 from unnest(filter_tags) t(tag)
        where not exists (select 1 from project_tech_tags ptt
                          where ptt.project_id = p.id and ptt.tech_tag_id = t.tag)))
  ),
  -- no_index documents are excluded from retrieval here, in ONE place (0016).
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
    -- The ORDER BY is load-bearing: 0005 fixed a defect where an unordered
    -- `limit 60` kept an ARBITRARY 60 rows, discarding rank #1 while keeping
    -- rank #4000. Do not remove it.
    order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc
    limit 60
  ),
  fused as (
    -- Reciprocal Rank Fusion. Cosine similarity (0-1) and ts_rank (unbounded)
    -- are not comparable numbers; ranks are. 1/(60+rank) from each list.
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
    -- MAX-pooling: a project scores as its single best chunk, not an
    -- aggregate. Summing would systematically favour projects with more
    -- chunks — a 40-page PDF would beat a sharp 200-word description. Do not
    -- "fix" this to sum().
    select distinct on (pid) pid, rrf, text, did
    from fused
    -- The FTS arm is deliberately unfloored: ts_rank is unbounded and
    -- uncalibrated, so there is no principled threshold, and a
    -- websearch_to_tsquery match is an exact lexical hit. §15.5 is enforced on
    -- the vector arm, which is the arm that generates spurious matches.
    where fts_id is not null or sim >= min_similarity
    order by pid, rrf desc
  )
  select r.pid,
         r.rrf::real,
         left(r.text, 300),
         case when d.is_synthetic then 'description' else d.filename end
  from ranked r
  left join documents d on d.id = r.did
  order by r.rrf desc
  limit match_limit;
end;
$$;
