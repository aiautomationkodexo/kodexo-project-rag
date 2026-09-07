-- ═══════════════════════════════════════════════════════════════════════════
-- 0010 — Raise the per-file ceiling to 200 MB for T7 (audio/video)
--
-- A 10-minute 1080p MP4 is routinely 80-150 MB and the user has no way to
-- shrink one, so 0001's 50 MB ceiling made T7's own acceptance criterion
-- ("a 10-minute MP4 transcribes") unreachable with a real recording.
--
-- Raising it is safe specifically because the media path never buffers:
-- Deepgram is handed a signed Storage URL and fetches the bytes itself, so a
-- 200 MB video never passes through a function. The 50 MB limit was bounding
-- in-function parsing, and that argument does not apply here.
--
-- Raised HERE rather than by editing 0001 and 0004: both are recorded as
-- applied, so an edit to either is a no-op on every existing project.
--
-- ── FLAT, NOT MIME-AWARE ───────────────────────────────────────────────────
--
-- The per-type rule (50 MB documents / 200 MB media) lives in
-- src/lib/uploads/mime.ts, which is the only gate that runs BEFORE the bytes
-- move — enforced in the dropzone and re-enforced in /api/upload-url.
--
-- A mime-aware CHECK here would look like enforcement and not be any:
-- storage.buckets.file_size_limit is a single scalar and cannot express the
-- rule at all, so Storage would accept a 200 MB PDF regardless. The CHECK would
-- then reject the row AFTER 200 MB of bytes were already in the bucket,
-- producing an orphaned object (Storage does not cascade from Postgres — that
-- is what the sweep's step 4 exists for) plus a confusing action-level error.
--
-- And the value being checked is client-supplied: the create action JSON-parses
-- `size` off the request body into size_bytes and nothing ever stats the stored
-- object. This constraint is a sanity BOUND on a self-reported number, not the
-- policy. Encoding policy in it would be a category error.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── documents.size_bytes ───────────────────────────────────────────────────
--
-- A CHECK cannot be altered in place; it must be dropped and re-added.
--
-- The constraint 0001 created was auto-named. Discovering it by DEFINITION
-- rather than trusting the generated name makes this replay-safe against a
-- database that was hand-patched at any point — and the loop is a no-op if it
-- finds nothing, so a re-run cannot fail. The replacement is named EXPLICITLY
-- so the next change to it is deterministic.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.documents'::regclass
      and contype  = 'c'
      and pg_get_constraintdef(oid) ilike '%size_bytes%'
  loop
    execute format('alter table public.documents drop constraint %I', c);
  end loop;
end $$;

-- Validated against existing rows on ADD rather than NOT VALID: every existing
-- row already satisfies a strictly wider bound, so the scan cannot fail and
-- NOT VALID + VALIDATE would be ceremony.
alter table public.documents
  add constraint documents_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 209715200);

-- ── Bucket ─────────────────────────────────────────────────────────────────
--
-- Restated rather than edited into 0004, for the reason in the banner.
--
-- Same soft-fail wrapper as 0004 and for the same reason: `db push` stops at
-- the first error, so an unguarded privilege failure here would strand every
-- later migration. Every block downgrades a privilege error to a warning, which
-- is what makes SETUP.md's verification queries mandatory rather than optional.
--
-- ⚠ THE PLATFORM GLOBAL LIMIT CAPS THIS. Storage → Settings → global file size
--   limit must be >= 200 MB, or the bucket silently clamps: this row reads
--   209715200, `verify:cloud` passes, and 200 MB uploads still fail with an
--   opaque Storage error.
--
-- ⚠ supabase/config.toml MUST be kept in step. `npm run buckets:push` writes
--   that file through the Storage REST API and would put 50 MiB straight back
--   over this. Both are set to 200MiB in the same change.
do $$
begin
  update storage.buckets
     set file_size_limit = 209715200
   where id = 'project-files';
exception
  when insufficient_privilege then
    raise warning
      '0010: cannot update storage.buckets as %. Run: npm run buckets:push',
      current_user;
end $$;
