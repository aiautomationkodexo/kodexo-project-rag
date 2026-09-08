-- ═══════════════════════════════════════════════════════════════════════════
-- 0016 — Document visibility
--
-- 'no_index' is the value with teeth: stored, never chunked, never embedded,
-- never retrieved.
--
-- ⚠ REVERSIBLE ONLY BECAUSE §15.2 PRESERVES raw_text. Flipping a document OUT
--   of no_index re-chunks from documents.raw_text; there is no other source —
--   storage_key is NULL for synthetic documents and the bucket object may
--   already have been purged by the 0009 sweep. This is the concrete payoff of
--   the "NEVER drop raw_text" invariant.
--
-- TWO VALUES, NOT FOUR. The proposal also listed 'internal' | 'public' |
-- 'on_request' as metadata for an MCP layer. There is no MCP server in this
-- repo, so those three would be stored, rendered in a <select>, and change
-- nothing — a control that implies an effect it does not have. Adding them
-- later is a drop-and-add of a NAMED constraint, which is the whole reason
-- this schema prefers CHECK over a Postgres enum.
--
-- DEFAULT 'indexed', NOT NULL. Every existing row is indexed today, so the
-- default IS the backfill and no UPDATE is needed. NOT NULL is load-bearing:
-- a nullable column makes `visibility <> 'no_index'` drop NULL rows under
-- SQL's three-valued logic, which would silently exclude every pre-existing
-- document from search — invisible in a small corpus, catastrophic later.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents
  add column if not exists visibility text not null default 'indexed';

alter table public.documents
  add constraint documents_visibility_check
  check (visibility in ('indexed', 'no_index'));

-- Partial index: the predicate both the pipeline and the search RPC filter on
-- is `visibility = 'no_index'`, and that set is expected to stay small — so
-- this is a few pages rather than one entry per document.
create index if not exists documents_no_index_idx
  on documents (project_id) where visibility = 'no_index';

comment on column public.documents.visibility is
  'indexed | no_index. no_index: raw_text kept, chunks deleted, pipeline skips '
  'chunk+embed, finalizeProject excludes it from the summariser corpus, and '
  'search_projects excludes its chunks. Reversible by re-queueing (§15.2).';

-- ═══════════════════════════════════════════════════════════════════════════
-- search_projects — excludes no_index documents
--
-- Reproduced from 0005 with TWO changes and nothing else: a `visible_docs`
-- CTE, and a join to it from both the vec and the fts arm. Every documented
-- decision in 0005 is preserved verbatim — RRF k=60, MAX-pooling via
-- DISTINCT ON, the unfloored FTS arm, the ordered FTS limit, ef_search=100.
--
-- BOTH arms must join it. Filtering only one leaves the document retrievable
-- through the other, which reads as an intermittent leak rather than a bug.
--
-- ── DEFENCE IN DEPTH, and both layers are required ────────────────────────
-- processDocument deletes the chunk set when a document goes no_index, so
-- this filter should normally find nothing to exclude. It exists because:
--   (i) a manual `update documents set visibility='no_index'` in the SQL
--       editor does NOT delete chunks, and that is a thing operators do;
--  (ii) if the delete path regresses, this is what keeps the guarantee true.
-- The chunk delete is what stops paying to store the embeddings; this filter
-- is what makes "never retrieved" hold when the delete did not run.
--
-- NOTE the interaction with `limit 60`: joining before the limit means the
-- HNSW candidate pool is consumed by the filter — the same recall concern
-- 0005:45-49 already documents for industry/tag filters, with the same
-- mitigation (ef_search=100). Fine at this corpus size; revisit with
-- pgvector 0.8's iterative_scan.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function search_projects(
  query_embedding extensions.vector(1536),
  query_text text default '',
  filter_industry text default null,
  filter_tags uuid[] default null,
  match_limit int default 10,
  min_similarity real default 0.30
)
returns table (project_id uuid, score real, best_snippet text, best_source text)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
begin
  -- SECURITY DEFINER bypasses RLS on projects/chunks/documents, so this guard
  -- IS the access check. That is correct today because projects:view is
  -- all-or-nothing with no per-project ACL.
  --
  -- STANDING INVARIANT: if per-project visibility is ever introduced, this
  -- function leaks every project to anyone holding projects:view until the
  -- `eligible` CTE is taught the same rule. RLS will not save you inside a
  -- definer function.
  if not has_claim((select auth.uid()), 'projects:view') then
    raise exception 'Missing permission: projects:view';
  end if;

  -- Widen the HNSW candidate pool. The vec CTE joins `eligible` AFTER the ANN
  -- scan, so with an industry/tag filter the top-N candidates can collapse to
  -- near zero eligible rows. Invisible at small scale (the planner seqscans and
  -- searches exactly); a silent recall problem as the corpus grows.
  -- pgvector 0.8's hnsw.iterative_scan = 'relaxed_order' is the real fix later.
  perform set_config('hnsw.ef_search', '100', true);

  return query
  -- §15.4: filters are PRE-filters, applied inside the SQL before ranking —
  -- never to a result set afterwards.
  with eligible as (
    select p.id from projects p
    where p.deleted_at is null
      and (filter_industry is null or p.industry = filter_industry)
      and (filter_tags is null or not exists (
        select 1 from unnest(filter_tags) t(tag)
        where not exists (select 1 from project_tech_tags ptt
                          where ptt.project_id = p.id and ptt.tech_tag_id = t.tag)))
  ),
  -- no_index documents are excluded from retrieval HERE, in one place.
  -- Filtering inside both the vec and fts CTEs would work but is two edits
  -- that must stay in step forever; a joined CTE is one.
  --
  -- ⚠ NOT `not in (select id from documents where visibility = 'no_index')`.
  --   NOT IN over a nullable subquery column yields NULL for every row the
  --   moment any value is NULL, which returns ZERO results silently.
  --   documents.visibility is NOT NULL so that is safe today, but the join
  --   form carries no such trap at all.
  visible_docs as (
    select d.id from documents d where d.visibility <> 'no_index'
  ),
  vec as (
    select c.id, c.project_id as pid, c.text, c.document_id,
           1 - (c.embedding <=> query_embedding) as sim,
           row_number() over (order by c.embedding <=> query_embedding) as rnk
    from chunks c
      join eligible e on e.id = c.project_id
      join visible_docs vd on vd.id = c.document_id
    where c.is_active and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit 60
  ),
  fts as (
    select c.id, c.project_id as pid, c.text, c.document_id,
           row_number() over (order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc) as rnk
    from chunks c
      join eligible e on e.id = c.project_id
      join visible_docs vd on vd.id = c.document_id
    where c.is_active and query_text <> ''
      and c.tsv @@ websearch_to_tsquery('english', query_text)
    -- FIX: the PRD had `limit 60` with NO order by at the CTE level. The window
    -- function ranked the whole matching set correctly, then an ARBITRARY 60
    -- rows survived the limit — rank #1 could be discarded while rank #4000 was
    -- kept, non-deterministically across runs. Compare the vec CTE, which was
    -- correctly ordered. This silently halved lexical search quality.
    order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc
    limit 60
  ),
  fused as (
    -- Reciprocal Rank Fusion. Cosine similarity (0–1) and ts_rank (unbounded)
    -- are not comparable numbers; ranks are. 1/(60+rank) from each list, summed.
    select coalesce(v.pid, f.pid) as pid,
           coalesce(v.text, f.text) as text,
           coalesce(v.document_id, f.document_id) as did,
           v.id as vec_id,
           f.id as fts_id,
           v.sim as sim,
           coalesce(1.0/(60+v.rnk),0) + coalesce(1.0/(60+f.rnk),0) as rrf
    from vec v full outer join fts f on f.id = v.id
  ),
  ranked as (
    -- DISTINCT ON keeps the first row per project under this ORDER BY, so the
    -- surviving row IS that project's highest-RRF chunk — best_snippet and
    -- best_source therefore come from the best-ranked chunk.
    --
    -- This is MAX-pooling: a project scores as its single best chunk, not an
    -- aggregate. Deliberate. Summing RRF across chunks would systematically
    -- favour projects with more chunks — a 40-page PDF would beat a sharp
    -- 200-word description. Do not "fix" this to sum().
    select distinct on (pid) pid, rrf, text, did
    from fused
    -- FIX: the PRD used `sim >= min_similarity or sim = 0`, relying on the
    -- float 0.0 as a sentinel for "FTS-only row". Mechanically it worked, but
    -- a genuine similarity of exactly 0.0 would pass the floor spuriously.
    -- Testing fts_id directly says the same thing without the sentinel.
    --
    -- The FTS arm is deliberately unfloored: ts_rank is unbounded and
    -- uncalibrated, so there is no principled threshold, and a
    -- websearch_to_tsquery match is an exact lexical hit — a legitimate result.
    -- §15.5 is therefore enforced on the vector arm, which is the arm that
    -- generates spurious matches.
    where fts_id is not null or sim >= min_similarity
    order by pid, rrf desc
  )
  select r.pid,
         r.rrf::real,
         left(r.text, 300),
         -- FIX: the PRD's coalesce(d.filename, 'description') is unreachable —
         -- chunks.document_id is NOT NULL with an FK, so the left join always
         -- matches and filename is NOT NULL. The synthetic document carries
         -- filename 'description' anyway; this makes the intent explicit.
         case when d.is_synthetic then 'description' else d.filename end
  from ranked r
  left join documents d on d.id = r.did
  order by r.rrf desc
  limit match_limit;
end;
$$;
