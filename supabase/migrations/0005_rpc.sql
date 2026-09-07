-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 — Search and pipeline RPCs
--
-- search_projects is the single hybrid-search entry point. PostgREST cannot
-- express pgvector operators, so every similarity query MUST go through .rpc();
-- there is no .select().order('embedding <=> ...') alternative.
-- ═══════════════════════════════════════════════════════════════════════════

-- FIX: default floor raised 0.15 → 0.30.
--
-- text-embedding-3-small vectors are not zero-centred. Two completely unrelated
-- English paragraphs routinely score 0.10–0.30 cosine; related-but-not-matching
-- lands 0.30–0.45; genuine matches sit 0.50+. At 0.15 the floor admits
-- essentially everything the ANN scan returns, so the vector arm can never
-- return an empty set and §15.5 ("search must be able to return nothing") is
-- not enforced in practice — which also makes the PRD's own empty state,
-- "No strong matches for that search", unreachable.
--
-- Re-tune against a real corpus once one exists.
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
  vec as (
    select c.id, c.project_id as pid, c.text, c.document_id,
           1 - (c.embedding <=> query_embedding) as sim,
           row_number() over (order by c.embedding <=> query_embedding) as rnk
    from chunks c join eligible e on e.id = c.project_id
    where c.is_active and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit 60
  ),
  fts as (
    select c.id, c.project_id as pid, c.text, c.document_id,
           row_number() over (order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc) as rnk
    from chunks c join eligible e on e.id = c.project_id
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Pipeline RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- §15.6: THE ONLY finalization gate.
--
-- Parallel completion means several invocations can each believe they are last.
-- A single conditional UPDATE resolves it — Postgres guarantees exactly one
-- winner. Do not replace this with an application-level "am I last?" check.
--
-- FIX: `and is_active` added to the pending count. Without it a document
-- deactivated while queued blocks finalization permanently.
create or replace function claim_finalize(p_project uuid)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare pending int;
begin
  select count(*) into pending from documents d
  where d.project_id = p_project
    and d.is_active
    and d.status in ('queued','processing');

  if pending > 0 then return false; end if;

  update projects set status = 'finalizing'
  where id = p_project and status = 'processing';

  return found;
end;
$$;

-- NOT IN THE PRD. Same single-conditional-UPDATE shape as claim_finalize,
-- applied one level down: it is what stops the cron sweep from double-
-- processing a document that a slow-but-alive invocation still holds.
--
-- Returns true only if THIS caller won the right to process the document.
--
-- TIMING INVARIANT — the 15 minutes below is the third term in:
--
--   TRANSCRIBE_TIMEOUT_MS (600s)  <  maxDuration (800s)  <  reclaim (900s)
--
-- The reclaim window MUST stay above the route's maxDuration, or a still-living
-- invocation's document becomes claimable and a second worker starts on it.
-- Two workers then race `delete chunks where document_id` against their own
-- inserts, which leaves a permanently duplicated chunk set — invisible except
-- as duplicate search snippets and double-weighted retrieval.
-- (0009's chunks_document_ordinal_idx makes that overlap fail loudly instead,
-- but it is a backstop, not a licence to shorten this interval.)
-- See src/app/api/process/[documentId]/route.ts and src/lib/ai/deepgram.ts.
create or replace function claim_document(p_document uuid)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
begin
  update documents
     set status = 'processing', attempts = attempts + 1
   where id = p_document
     and is_active
     and (status = 'queued'
          or (status = 'processing' and updated_at < now() - interval '15 minutes'));
  return found;
end;
$$;

-- FIX: the PRD selected only status = 'processing'. But the error path sets a
-- retryable document back to 'queued', and claim_finalize counts 'queued' as
-- pending — so a document that failed once was never retried AND its project
-- sat in 'processing' forever. One transient OpenAI 429 was enough to strand a
-- project permanently, which would have made T4's acceptance criterion a coin
-- flip.
--
-- Columns are qualified via the `d` alias: the OUT parameters are named `id`
-- and `project_id`, which collide with the table's own column names in a
-- language-sql body.
create or replace function stuck_documents(older_than_minutes int default 15)
returns table (id uuid, project_id uuid)
language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select d.id, d.project_id
  from documents d
  where d.is_active
    and d.status in ('queued','processing')
    and d.updated_at < now() - (older_than_minutes || ' minutes')::interval
    and d.attempts < 3
  limit 50;
$$;

-- ── Execute grants ─────────────────────────────────────────────────────────
-- claim_finalize and claim_document are unguarded state mutations; without the
-- revoke, any authenticated user could flip an arbitrary project to
-- 'finalizing'. They are called only by the pipeline, which uses the service
-- role.
revoke execute on function claim_finalize(uuid), claim_document(uuid),
  stuck_documents(int) from public;
grant execute on function claim_finalize(uuid), claim_document(uuid),
  stuck_documents(int) to service_role;

-- search_projects stays available to authenticated; its own has_claim guard
-- is the gate.
revoke execute on function
  search_projects(extensions.vector, text, text, uuid[], int, real) from public;
grant execute on function
  search_projects(extensions.vector, text, text, uuid[], int, real)
  to authenticated, service_role;
