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
