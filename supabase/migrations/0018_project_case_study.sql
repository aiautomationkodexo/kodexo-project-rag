-- ═══════════════════════════════════════════════════════════════════════════
-- 0018 — Case study outline
--
-- One generated DOCX per project: an outline a BD or marketing writer fills
-- in, derived from the same corpus the summary is derived from. Regenerated
-- whenever that corpus changes; the previous object is deleted permanently.
--
-- ── ⚠ THE OUTLINE MUST NEVER BECOME CORPUS ────────────────────────────────
--   This is the single highest-risk property of the feature, and the failure
--   is a FEEDBACK LOOP rather than a leak. Give the generated file a
--   `documents` row and the pipeline extracts its text, chunks it, embeds it,
--   and finalizeProject feeds it back into generateSummary — which then
--   summarises its own prior output. Every regeneration compounds the
--   distortion. NOTHING THROWS. It surfaces months later as summaries that
--   have drifted into self-reference, with no error anywhere to explain it.
--
--   Two structural defences, and BOTH are required:
--
--     1. NO `documents` ROW, EVER. The outline is tracked in this table
--        instead. Every corpus reader in the system — finalizeProject's
--        select, processDocument, search_projects — reads `documents`, so a
--        thing with no row there is unreachable BY CONSTRUCTION, not by a
--        filter somebody has to remember to add.
--
--     2. A SEPARATE KEY PREFIX: `case-studies/{projectId}/…`, never
--        `projects/{projectId}/…`. See the note on storage_key below — that
--        one is load-bearing against the 0009 sweep, not merely tidy.
--
-- ── ONE ROW PER PROJECT, ENFORCED BY THE PRIMARY KEY ──────────────────────
-- project_id is BOTH the primary key AND the foreign key. That is what makes
-- "one live outline per project" a schema guarantee rather than an
-- application convention — there is no `unique` to forget and no ordinal to
-- get wrong. Contrast 0017's two tables, which are genuinely lists.
--
-- ── A CHILD TABLE, NOT `projects` COLUMNS ─────────────────────────────────
-- Same reason 0017 gives: 0013 revoked the table-level UPDATE grant on
-- `projects` and re-granted 14 named columns, so ANY new `projects` column is
-- un-updatable by `authenticated` (42501 on save) until someone returns to
-- that grant list. A child table sidesteps that standing cost and needs NO
-- `grant` statement here at all — Supabase's bootstrap grant to
-- `authenticated` applies, exactly as project_links (0015) relies on.
--
-- ── NO VERSION HISTORY, DELIBERATELY ──────────────────────────────────────
-- One row, one object, the previous one permanently gone — as specified.
-- `project_summaries` is the precedent if a rollback path is ever wanted;
-- adding one here means keeping every superseded object, which is exactly
-- what this feature was asked NOT to do.
-- ═══════════════════════════════════════════════════════════════════════════

create table project_case_study (
  -- PK *and* FK. See the header: this is the one-per-project guarantee.
  project_id   uuid primary key references projects(id) on delete cascade,

  -- The model's structured output: an ordered array of
  -- {key, label, content} sections.
  --
  -- STORED EVEN THOUGH THE DOCX IS THE DELIVERABLE, for two reasons. It lets
  -- the project page render the outline without downloading and parsing a
  -- Word file, and it means a failed UPLOAD does not destroy a successful
  -- GENERATION — the expensive half is the model call, and keeping it makes
  -- the retry free.
  --
  -- jsonb, not a child table of sections: nothing queries inside it, nothing
  -- joins to it, and the array's ORDER is meaningful. The same reasoning that
  -- keeps projects.summary as jsonb (§15.12).
  outline      jsonb not null,

  -- The live object's key, or NULL for "there is no live object".
  --
  -- ⚠ THE `case-studies/` PREFIX IS LOAD-BEARING AND MUST NOT BE CHANGED TO
  --   `projects/`. The 0009 sweep's removeAbandonedUploads() walks
  --   `projects/{projectId}` and deletes every child prefix whose name is not
  --   a live `documents.id`, once it is older than 30 minutes. An outline
  --   stored under that prefix has no `documents` row BY DESIGN (see the
  --   header), so that sweep would delete every live outline half an hour
  --   after generating it — silently, on a 5-minute cron, presenting as a
  --   download link that worked when the user first loaded the page and 404s
  --   when they come back. The prefix separation is the whole defence.
  --
  -- NULLABLE, and null is a real state rather than an error: the generation
  -- succeeded but the upload failed, or the 0009 purge reclaimed the bytes of
  -- a soft-deleted project. Mirrors documents.storage_key, which the sweep
  -- nulls for exactly that reason — read paths MUST treat null as "no
  -- download available" and still render the outline from `outline`.
  storage_key  text
                 constraint project_case_study_key_prefix
                 check (storage_key is null
                        or storage_key like 'case-studies/%'),

  -- The download filename. Stored rather than derived because the project
  -- title can change after generation, and a file whose name disagrees with
  -- the document it contains is worse than a stale name.
  filename     text not null
                 constraint project_case_study_filename_not_blank
                 check (length(trim(filename)) > 0),

  -- Reported to the user next to the download link. NOT a bound on anything:
  -- this file is produced by us, not uploaded, so there is no client-reported
  -- number to distrust and no cap to enforce.
  size_bytes   int
                 constraint project_case_study_size_positive
                 check (size_bytes is null or size_bytes > 0),

  -- Provenance. `model` is recorded because CHAT_MODEL is swappable via
  -- OPENAI_CHAT_MODEL, so "which model wrote this outline" is not derivable
  -- from the code at read time.
  model        text,
  generated_at timestamptz not null default now()
);

-- No index on project_id — it is the primary key, which is already an index.
-- (project_features needs one because its PK is a synthetic id.)

-- MANDATORY. Supabase's bootstrap grants `authenticated` access to public
-- tables, so a table created without this is readable by every signed-in user
-- regardless of which policies exist below.
alter table project_case_study enable row level security;

-- ── SELECT on projects:view, and NO WRITE POLICY AT ALL ───────────────────
-- Deliberately modelled on `chunks` (0002) rather than on project_links: this
-- table is written EXCLUSIVELY by the pipeline via the service role, which
-- bypasses RLS entirely. No user client has any reason to write it — there is
-- no editing UI and no approve step, because the next regenerate replaces the
-- row wholesale.
--
-- The ABSENCE of a write policy is therefore the authorization decision, not
-- an omission. Adding a `for all` policy here would grant every
-- projects:update holder the ability to point storage_key at an arbitrary
-- object in the bucket, which the download route would then sign for them.
create policy case_study_select on project_case_study
for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

comment on table project_case_study is
  'One AI-generated case study outline per project, materialised as a DOCX in '
  'the project-files bucket. REPLACED WHOLESALE on every regeneration and the '
  'previous object hard-deleted — no version history, deliberately. Written '
  'only by the pipeline via the service role; there is no write policy. '
  'NEVER given a `documents` row: that would feed the generated text back '
  'into the corpus it was generated from.';

comment on column project_case_study.outline is
  'Ordered array of {key, label, content}. ARRAY ORDER IS DISPLAY '
  'ORDER (§15.12) — read paths must not sort it. Kept alongside the DOCX so a '
  'failed upload does not discard a successful (and expensive) generation.';

comment on column project_case_study.storage_key is
  'Live object key, always under the `case-studies/` prefix — NOT `projects/`, '
  'which the 0009 sweep would treat as an abandoned upload and delete. NULL '
  'means no downloadable object; render the outline from `outline` anyway.';
