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
