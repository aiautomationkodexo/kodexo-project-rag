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
