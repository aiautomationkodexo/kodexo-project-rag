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
