-- ═══════════════════════════════════════════════════════════════════════════
-- 0017 — Features delivered and proof points
--
-- Two AI-extracted lists rendered on the project page, both derived from the
-- same corpus the summary is derived from.
--
-- FULL WIPE AND REBUILD on every finalize: delete every row for the project,
-- insert the freshly extracted set. That is safe ONLY because no row in
-- either table is human-authored — there is no editing UI, no is_reviewed
-- column and no approval workflow, deliberately. If an edit affordance is
-- ever added the wipe becomes destructive, and this paragraph is the warning.
--
-- Contrast §15.8, which forbids DELETING tech tags on regeneration: a tag is
-- shared vocabulary that a human curates through the 0011 approve/merge
-- queue, so losing one loses work. These rows are disposable model output
-- scoped to one project. Different data, different rule.
--
-- ── TWO TABLES, NOT ONE `kind` DISCRIMINATOR ──────────────────────────────
-- A shared table would force claim/metric/evidence_quote/source_document_id
-- all nullable so a feature row can leave them empty — converting four NOT
-- NULL guarantees into four application-level conventions, and turning
-- "a proof point must have a quote" into a conditional
-- `check (kind <> 'proof_point' or evidence_quote is not null)` that is easy
-- to get wrong and hard to read. Only proof points carry an FK, and its
-- `on delete` behaviour cannot be expressed per-kind in one table. The extra
-- boilerplate buys real constraints; take it.
--
-- ── CHILD TABLES, NOT `projects` COLUMNS ──────────────────────────────────
-- 0013 revoked the table-level UPDATE grant on `projects` and re-granted 14
-- named columns, so ANY new `projects` column is un-updatable by
-- `authenticated` (42501 on save) until someone returns to that grant list.
-- Child tables sidestep that standing cost entirely, and need NO `grant`
-- statement here at all — Supabase's bootstrap grant to `authenticated`
-- applies, exactly as project_links (0015) relies on.
--
-- ── NO NEW CLAIM ──────────────────────────────────────────────────────────
-- Read on projects:view, write on projects:update, mirroring project_links.
-- These are derived views of a corpus the reader can already see: anyone who
-- may read the summary these were extracted from may read these.
--
-- ── ⚠ THE NO-CLIENT-NAME RULE IS A MITIGATION, NOT A CONTROL ──────────────
--   The extraction prompt (OUTCOMES_SYSTEM rule 8) forbids naming any client,
--   customer, company or brand in any field, and requires attribution by
--   ROLE. That is a REQUEST TO A LANGUAGE MODEL, not a boundary.
--
--   The model receives documents.raw_text, which genuinely contains those
--   names, and evidence_quote is VERBATIM by design — so it is the highest-
--   risk field in this schema by construction. A leak is possible and nothing
--   in SQL detects or prevents one.
--
--   The structural guarantees elsewhere are unchanged and are NOT weakened:
--   project_client is still never read by finalizeProject, and
--   projects:view-client-info still gates the client name itself. What this
--   migration adds is a NEW surface where a name could appear as a side
--   effect of quoting. Treat these rows as exactly as trustworthy as the
--   corpus — no more.
--
--   Nothing here is chunked or embedded, so a leaked name does not enter the
--   vector index by this route. It is visible on the project page only.
--   No UI copy may describe these lists as anonymised.
-- ═══════════════════════════════════════════════════════════════════════════

create table project_features (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null constraint project_features_name_not_blank
                check (length(trim(name)) > 0),
  description text not null constraint project_features_description_not_blank
                check (length(trim(description)) > 0),
  -- Display order, taken from the model's array index at insert time.
  --
  -- NOT derivable from created_at, and that is the whole reason this column
  -- exists: a wipe-and-rebuild inserts every row in ONE statement, so now()
  -- is identical across all of them and `order by created_at` is genuinely
  -- non-deterministic — the same class of silent bug as the PRD's unordered
  -- `limit 60` in the FTS CTE (see 0005). The model emits these
  -- most-significant-first and that judgement survives nowhere else.
  ordinal     int not null constraint project_features_ordinal_non_negative
                check (ordinal >= 0),
  created_at  timestamptz not null default now(),
  -- Makes a duplicate-ordinal bug fail LOUDLY (23505 on insert) rather than
  -- silently returning rows in an arbitrary order.
  constraint project_features_project_ordinal_key unique (project_id, ordinal)
);

create index project_features_project_idx on project_features (project_id);

-- MANDATORY. Supabase's bootstrap grants `authenticated` access to public
-- tables, so a table created without this is readable by every signed-in user
-- regardless of which policies exist below.
alter table project_features enable row level security;

-- Mirrors the project policies, as project_links does: read with
-- projects:view, write with projects:update. Both arms use the
-- `(select has_claim((select auth.uid()), ...))` double-subquery form so the
-- planner hoists them into an InitPlan evaluated once per statement (0002).
create policy features_select on project_features for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy features_write on project_features for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

comment on table project_features is
  'AI-extracted list of what the project delivered. FULL WIPE AND REBUILD on '
  'every finalize — no row here is human-authored, so nothing is preserved. '
  'Rendered with a permanent "AI - Unreviewed" provenance badge; there is no '
  'review workflow and no is_reviewed column, deliberately. Adding an approve '
  'affordance would be a control with no effect: the next regenerate destroys '
  'these rows.';

comment on column project_features.ordinal is
  'Model-emitted display order, 0-based and gapless. Read paths MUST '
  'order by ordinal — created_at is identical across a batch insert and '
  'cannot order these.';

create table project_proof_points (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  -- The quantified outcome, stated as a claim.
  claim               text not null
                        constraint project_proof_points_claim_not_blank
                        check (length(trim(claim)) > 0),
  -- The isolated figure ('11 minutes to under 2', '310 drivers').
  --
  -- Nullable on purpose: a genuine proof point can be qualitative, and a NOT
  -- NULL here would be an instruction to the model to invent a number for
  -- every entry. Prompt rule 5 says null rather than fabricate; the schema
  -- has to permit that or the rule is unfollowable.
  metric              text,
  -- VERBATIM from the corpus. This is what makes a proof point checkable
  -- rather than an assertion — and it is the single highest-risk field in
  -- this schema for an unredacted client name. See the header.
  evidence_quote      text not null
                        constraint project_proof_points_quote_not_blank
                        check (length(trim(evidence_quote)) > 0),
  -- Which document the quote came from.
  --
  -- ON DELETE SET NULL, NOT CASCADE. The quote is stored here verbatim, so a
  -- proof point survives its source document's hard deletion with only its
  -- attribution degraded. CASCADE would let the 0009 sweep silently destroy
  -- extracted claims when it purges a deleted project's documents — data loss
  -- disguised as referential tidiness.
  --
  -- DEACTIVATION (is_active = false) does not touch this FK at all: the row
  -- keeps pointing at a now-inactive document until the re-summary that the
  -- deactivation triggers wipes and rebuilds these rows from a corpus that
  -- excludes it. There is therefore a real window where this resolves to a
  -- document the project no longer shows, so read paths MUST tolerate a
  -- source that resolves to nothing renderable and omit the attribution
  -- rather than assuming a filename.
  source_document_id  uuid references documents(id) on delete set null,
  ordinal             int not null
                        constraint project_proof_points_ordinal_non_negative
                        check (ordinal >= 0),
  created_at          timestamptz not null default now(),
  constraint project_proof_points_project_ordinal_key
    unique (project_id, ordinal)
);

create index project_proof_points_project_idx
  on project_proof_points (project_id);

-- The FK's own index. Postgres does NOT create one for a REFERENCING column,
-- and without it every `delete from documents` takes a seqscan of this table
-- per row deleted — which the 0009 sweep does in batches of 100.
create index project_proof_points_document_idx
  on project_proof_points (source_document_id);

alter table project_proof_points enable row level security;

create policy proof_points_select on project_proof_points
for select to authenticated
using ((select has_claim((select auth.uid()), 'projects:view')));

create policy proof_points_write on project_proof_points
for all to authenticated
using ((select has_claim((select auth.uid()), 'projects:update')))
with check ((select has_claim((select auth.uid()), 'projects:update')));

comment on table project_proof_points is
  'AI-extracted quantified outcomes, each carrying a verbatim evidence quote. '
  'FULL WIPE AND REBUILD on every finalize. The extraction prompt forbids '
  'naming any client, company or brand and requires attribution by role — '
  'that is a MITIGATION, NOT A CONTROL: raw_text contains those names and '
  'nothing here detects a leak. Never chunked, never embedded.';

comment on column project_proof_points.evidence_quote is
  'Verbatim corpus text. Highest-risk field in this schema for an unredacted '
  'client name; the prompt rule is a request to a model, not a boundary.';

comment on column project_proof_points.source_document_id is
  'Nullable, ON DELETE SET NULL. Null means the source was hard-deleted or a '
  'model-reported filename matched nothing. Render without attribution — '
  'never assume it resolves.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Document removal needs NO SQL, and that was verified rather than assumed.
--
-- soft_delete_project (0006) MUST be an RPC because projects_select filters
-- `deleted_at is null` and Postgres checks an UPDATE's NEW row against the
-- SELECT policy — so writing deleted_at makes the row invisible to its own
-- writer and raises "new row violates row-level security policy".
--
-- documents_select (0002) filters ONLY on the claim, NOT on is_active —
-- contrast chunks_select, which does filter it. So writing
-- documents.is_active = false leaves the NEW row visible to its writer and a
-- plain UPDATE succeeds. `documents` also has no column-grant lockdown
-- (0007/0011/0013 locked down profiles, tech_tags and projects only), so
-- documents_update's projects:update check is the whole authorization story.
--
-- Do NOT add an RPC for setDocumentActive. It would be ceremony that implies
-- the 0006 trap applies here, which it does not.
-- ═══════════════════════════════════════════════════════════════════════════
