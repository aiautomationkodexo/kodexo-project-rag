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
