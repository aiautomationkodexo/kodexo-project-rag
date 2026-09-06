-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 — Storage bucket + policies, Realtime publication
--
-- PRD §3 puts both of these in the dashboard. They belong in a migration:
-- a dashboard click is not reviewable, not reproducible on a fresh project,
-- and not applied by `supabase db reset`.
--
-- The bucket is used from T6 onward. Creating it now means T6 adds no
-- infrastructure — only the upload route and the extractors.
-- ═══════════════════════════════════════════════════════════════════════════

-- Private bucket. 50 MB per file (PRD §10), mirroring the documents.size_bytes
-- CHECK so the limit is enforced on both sides of the upload.
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
on conflict (id) do nothing;

-- Path convention: projects/{project_id}/{document_id}/{filename}
-- Same InitPlan-hoisting treatment as 0002.

create policy storage_read on storage.objects for select to authenticated
using (bucket_id = 'project-files'
       and (select has_claim((select auth.uid()), 'projects:view')));

create policy storage_write on storage.objects for insert to authenticated
with check (bucket_id = 'project-files'
            and ((select has_claim((select auth.uid()), 'projects:create'))
              or (select has_claim((select auth.uid()), 'projects:update'))));

create policy storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'project-files'
       and (select has_claim((select auth.uid()), 'projects:delete')));

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

alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.documents;
