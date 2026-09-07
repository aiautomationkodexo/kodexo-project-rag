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
