-- ═══════════════════════════════════════════════════════════════════════════
-- 0009 — Sweep recovery + storage lifecycle
--
-- Three things the cron sweep (PRD §13) cannot express through PostgREST, plus
-- one index that turns a silent corruption into a loud error.
--
-- ── DEFECT IN THE PRD (§13 step 3) ─────────────────────────────────────────
--
-- The PRD specifies deleting Storage objects "with no matching `documents`
-- row", and justifies it with: "Supabase Storage does not cascade from Postgres
-- deletes. Step 3 is required or deleted projects keep costing storage."
--
-- That rule does not do what that sentence says. `soft_delete_project`
-- (0006) only sets `deleted_at`; the `documents` rows survive, and NOTHING in
-- this codebase hard-deletes a project. So every object belonging to a deleted
-- project still HAS a matching documents row, and the rule as written sweeps
-- exactly none of them. Implemented literally, the leak it names stays open.
--
-- Two rules are needed, and they are different queries:
--
--   purgeable_projects  — soft-deleted past a retention window. The actual
--                         leak. Keyed on projects.deleted_at, not on row
--                         absence.
--   (abandoned uploads) — object with no documents row. Real, but a much
--                         narrower case: the user closed the tab between the
--                         upload finishing and the server action inserting the
--                         row. Driven from Storage, so it lives in the route,
--                         not here.
--
-- ── DEFECT: a project can strand in 'processing' forever ───────────────────
--
-- `maybeFinalize` runs inside the calling route's `after()`. If that invocation
-- dies before claim_finalize commits — killed at maxDuration, or the platform
-- reclaiming a frozen instance — the document is 'done' but the project stays
-- 'processing', and nothing retries it:
--
--   stuck_documents  selects DOCUMENTS; every one of them is already 'done'.
--   sweep step 2     unstrands 'finalizing' projects; this one never got there.
--
-- The project shows "processing" in the UI forever with no error anywhere.
-- Pre-existing, but near-unreachable while the longest document was a PDF. A
-- 600-second transcription (T7) makes it reachable, so it gets a recovery path:
-- stranded_projects feeds /api/finalize/{id}, which routes through
-- claim_finalize — §15.6 holds, there is still exactly one gate.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Chunk uniqueness ───────────────────────────────────────────────────────
--
-- NOT IN THE PRD. process_document does `delete chunks where document_id = ...`
-- then inserts, which is correct for one worker and silently wrong for two: the
-- interleaving B-deletes → A-inserts → B-inserts leaves a permanently duplicated
-- chunk set. Nothing surfaces it. The document reads 'done', the UI shows
-- nothing unusual, and the only symptom is duplicate search snippets and a
-- project that is double-weighted in retrieval forever.
--
-- Two workers should be impossible — claim_document is the gate, and
-- maxDuration (800s) < the reclaim window (900s) means the first invocation is
-- always dead before the row becomes claimable again. This index is what makes
-- that ordering FAIL LOUDLY if someone ever changes one of those numbers
-- without the other: the overlap becomes a 23505 on the existing transient
-- retry path instead of corruption nobody can see.
--
-- Existing duplicates are removed first, keeping the lowest id per (document,
-- ordinal). If any exist they are already corruption; the index cannot be
-- created while they remain.
delete from chunks c
using chunks keep
where c.document_id = keep.document_id
  and c.ordinal     = keep.ordinal
  and c.id          > keep.id;

create unique index if not exists chunks_document_ordinal_idx
  on chunks (document_id, ordinal);

-- ── Recovery: projects stranded in 'processing' ────────────────────────────
--
-- The mirror of claim_finalize's own pending count, and it must STAY a mirror:
-- `is_active` is in that count (0005 FIX), so a project whose only outstanding
-- document was deactivated is finalizable and belongs in this result.
--
-- PostgREST cannot express the `not exists`, which is why this is an RPC rather
-- than a query in the route.
--
-- No `attempts` ceiling, unlike stuck_documents. Re-finalizing is idempotent —
-- claim_finalize's conditional UPDATE means a project that already escaped
-- returns false and does nothing — so there is no runaway to bound. The
-- `limit` bounds the sweep's work per tick instead.
create or replace function stranded_projects(older_than_minutes int default 15)
returns table (id uuid)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select p.id
  from projects p
  where p.status = 'processing'
    and p.deleted_at is null
    and p.updated_at < now() - (older_than_minutes || ' minutes')::interval
    and not exists (
      select 1 from documents d
      where d.project_id = p.id
        and d.is_active
        and d.status in ('queued','processing'))
  limit 50;
$$;

-- ── Storage lifecycle: soft-deleted projects past retention ────────────────
--
-- Returns the object keys to remove, NOT the projects. The caller needs keys
-- for storage.remove() and document ids to null out storage_key afterwards, and
-- returning both in one round trip keeps the route from re-querying.
--
-- Rows are deliberately NOT deleted, here or by the caller: projects.created_by
-- / last_updated_by and the audit trail reference them, `raw_text` is §15.2's
-- re-chunk and model-migration path, and the summary is the record of what the
-- project WAS. Only the billable bytes go.
--
-- The 30-day default is the undelete grace period. It is a default rather than
-- a hardcoded interval so it can be tuned from the caller without a migration.
--
-- `storage_key is not null` excludes both synthetic documents (which never had
-- a file) and rows already purged by an earlier sweep — that second one is what
-- makes this converge instead of re-listing the same project every 5 minutes
-- forever.
create or replace function purgeable_projects(
  older_than_days int default 30,
  match_limit int default 200
)
returns table (project_id uuid, document_id uuid, storage_key text)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select d.project_id, d.id, d.storage_key
  from documents d
  join projects p on p.id = d.project_id
  where p.deleted_at is not null
    and p.deleted_at < now() - (older_than_days || ' days')::interval
    and d.storage_key is not null
  limit match_limit;
$$;

-- ── Abandoned-upload support ───────────────────────────────────────────────
--
-- Step 5 of the sweep walks Storage prefixes, which only the route can do. It
-- needs two things from Postgres: which projects are worth walking, and which
-- document ids under a project are legitimate.
--
-- Scoped to RECENT projects on purpose. An abandoned object is always created
-- within minutes of project activity — /api/upload-url mints the key during an
-- upload the user was, at that moment, actually performing — so a 24h window
-- catches essentially all of them while bounding a walk that would otherwise be
-- O(every project) on a 5-minute cron.
create or replace function recently_active_projects(
  within_hours int default 24,
  match_limit int default 20
)
returns table (id uuid)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select p.id
  from projects p
  where p.updated_at > now() - (within_hours || ' hours')::interval
  order by p.updated_at desc
  limit match_limit;
$$;

-- ── Execute grants ─────────────────────────────────────────────────────────
-- All four are sweep-only and read the whole table set without reference to
-- auth.uid(). service_role exclusively; without the revoke, Postgres' default
-- grant to PUBLIC would let any authenticated user enumerate deleted projects'
-- storage keys.
revoke execute on function stranded_projects(int), purgeable_projects(int, int),
  recently_active_projects(int, int) from public;
grant execute on function stranded_projects(int), purgeable_projects(int, int),
  recently_active_projects(int, int) to service_role;
