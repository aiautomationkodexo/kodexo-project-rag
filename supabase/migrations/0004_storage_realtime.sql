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
