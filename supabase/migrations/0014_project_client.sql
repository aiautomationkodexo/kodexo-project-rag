-- ═══════════════════════════════════════════════════════════════════════════
-- 0014 — Client information
--
-- A SEPARATE TABLE, not a column on projects. RLS is ROW-level: there is no
-- policy that hides one column of a row you can otherwise read. The
-- alternative — column grants plus a definer read RPC, mirroring 0007 —
-- works, but it requires auditing every `select` in queries.ts forever and it
-- fails open when somebody adds a column list without thinking. A separate
-- table makes the leak structurally impossible: no policy, no rows.
--
-- §15.10 already bans select("*") in queries.ts, which helps. This makes even
-- a mistake there harmless.
--
-- ── NEVER ENTERS THE RAG ───────────────────────────────────────────────────
-- Nothing in this table is chunked, embedded, or written into summary_text.
-- The pipeline never reads it. See src/lib/pipeline/finalize-project.ts.
--
-- HONEST LIMITATION, stated so nobody over-claims: source documents still
-- contain the client's name in documents.raw_text and therefore in chunks.text
-- and the embeddings. Excluding the FIELD from the RAG does not scrub the
-- CORPUS. What holds is: the structured field is not retrievable; the prose
-- may still mention the client. True scrubbing (NER or a known-names pass) is
-- separate, larger work.
-- ═══════════════════════════════════════════════════════════════════════════

create table project_client (
  project_id  uuid primary key references projects(id) on delete cascade,
  client_name text,
  -- Room for contact, account manager, billing reference. Added when needed;
  -- an empty column is cheaper than a second migration to a used table.
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- MANDATORY. 0002's opening comment: Supabase's bootstrap grants
-- `authenticated` access to public tables, so a table created WITHOUT this is
-- readable by every signed-in user regardless of which policies exist.
alter table project_client enable row level security;

-- Both a select AND a write policy are required. Omitting the write policy
-- makes the table permanently read-only — RLS denies what no policy permits.
create policy project_client_select on project_client for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view-client-info')));

create policy project_client_write on project_client for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:view-client-info')))
with check ((select has_claim((select auth.uid()), 'projects:view-client-info')));

-- Reuses the trigger projects/documents/profiles already share (0001:257).
-- Without it updated_at is written once at insert and never again, which is a
-- silently stale audit trail on the one table whose edits are most sensitive.
create trigger project_client_touch before update on project_client
  for each row execute function touch_updated_at();

comment on table project_client is
  'Client identity, gated by projects:view-client-info. NEVER chunked, '
  'embedded, or written into summary_text. See 0014 header for the limits.';
