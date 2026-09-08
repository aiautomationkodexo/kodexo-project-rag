import "server-only";

import { createClient } from "@/lib/supabase/server";
import { embedQuery } from "@/lib/ai/openai";
import { toVector } from "@/lib/supabase/vector";
import type { Paged } from "@/lib/pagination";
import {
  asDocumentStatus,
  asProjectStatus,
  type DocumentRow,
  type ProjectListItem,
  type ProjectSearchResult,
  type SearchHit,
  type FeatureRow,
  type ProofPointRow,
} from "@/lib/types";

/**
 * §15.10: list queries NEVER select raw_text, embedding or summary_embedding.
 * Every select below is an explicit column list. `select("*")` is banned in
 * this file — a vector column is ~6KB of text per row over the wire.
 */
const LIST_COLUMNS =
  "id, title, status, industry, summary_text, created_at, project_tech_tags(tech_tags(id, canonical_name, is_approved))";

type RawListRow = {
  id: string;
  title: string;
  status: ProjectListItem["status"];
  industry: string | null;
  summary_text: string | null;
  created_at: string;
  project_tech_tags:
    | { tech_tags: { id: string; canonical_name: string; is_approved: boolean } | null }[]
    | null;
};

function toListItem(row: RawListRow): ProjectListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    industry: row.industry,
    summary_text: row.summary_text,
    created_at: row.created_at,
    tags: (row.project_tech_tags ?? [])
      .map((j) => j.tech_tags)
      .filter((t): t is NonNullable<typeof t> => !!t),
  };
}

export async function listIndustries(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("industries").select("name").order("name");
  return (data ?? []).map((r) => r.name);
}

/**
 * Builds a Paged<T> from a PostgREST `count` and the caller's window.
 *
 * `count` is `number | null` — null when the request did not ask for one, and
 * treating that as 0 would silently render "0 results" over a full table. The
 * fallback is the row count actually returned, which is never wrong by more
 * than the last page.
 */
function toPaged<T>(
  items: T[],
  count: number | null,
  page: number,
  perPage: number,
): Paged<T> {
  const total = count ?? items.length;
  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

/**
 * A page of projects.
 *
 * Uses `.range()` + `{ count: "exact" }` — the previous `.limit()` returned a
 * window with no total, so "Page 1 of N" was unrepresentable and the UI could
 * only offer "show 5/10/25". `exact` (rather than `planned`/`estimated`) runs a
 * real COUNT: this table is a few thousand rows of internal portfolio at most,
 * and an estimate that disagrees with the visible rows is worse than the
 * milliseconds it saves.
 *
 * OVER-RANGE IS HANDLED HERE, NOT BY THE CALLER. A page cannot clamp `?page=`
 * before querying because the total is not known until the query returns.
 * PostgREST answers an out-of-range window with zero rows AND the true count,
 * so when the requested page overshoots we re-query the last real page. That
 * costs a second round trip only on a URL nobody navigates to by hand, and it
 * is what stops `?page=9999` rendering an empty table with both arrows dead.
 */
export async function listProjects(options: {
  industry?: string | null;
  page: number;
  perPage: number;
  sort: "recent" | "oldest";
}): Promise<Paged<ProjectListItem>> {
  const supabase = await createClient();

  const run = async (page: number) => {
    const from = (page - 1) * options.perPage;
    let query = supabase
      .from("projects")
      .select(LIST_COLUMNS, { count: "exact" })
      .is("deleted_at", null)
      .order("created_at", { ascending: options.sort === "oldest" })
      .range(from, from + options.perPage - 1);

    if (options.industry) query = query.eq("industry", options.industry);

    const { data, count } = await query;
    return {
      items: ((data ?? []) as unknown as RawListRow[]).map(toListItem),
      count,
    };
  };

  const first = await run(options.page);
  const pageCount = Math.max(
    1,
    Math.ceil((first.count ?? first.items.length) / options.perPage),
  );

  if (options.page > pageCount) {
    const last = await run(pageCount);
    return toPaged(last.items, last.count, pageCount, options.perPage);
  }

  return toPaged(first.items, first.count, options.page, options.perPage);
}

/**
 * The dashboard tiles.
 *
 * One round trip per counter, all `head: true` — no rows cross the wire, only
 * the Content-Range header. Running them in parallel keeps the dashboard at
 * the cost of its slowest count rather than their sum.
 *
 * `failedDocuments` counts DOCUMENTS, not projects, and only active ones: a
 * superseded upload that failed before being replaced is not a live problem
 * and must not keep the tile red forever.
 */
export async function getPortfolioStats(): Promise<{
  total: number;
  processing: number;
  ready: number;
  failedDocuments: number;
}> {
  const supabase = await createClient();

  const projectCount = (status?: "processing" | "finalizing" | "ready") => {
    let q = supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);
    if (status) q = q.eq("status", status);
    return q;
  };

  const [total, processing, finalizing, ready, failed] = await Promise.all([
    projectCount(),
    projectCount("processing"),
    projectCount("finalizing"),
    projectCount("ready"),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .eq("is_active", true),
  ]);

  return {
    total: total.count ?? 0,
    // `processing` and `finalizing` are one idea to a reader — both mean "the
    // pipeline still owes you a summary". Splitting them across two tiles
    // would surface an implementation detail as a metric.
    processing: (processing.count ?? 0) + (finalizing.count ?? 0),
    ready: ready.count ?? 0,
    failedDocuments: failed.count ?? 0,
  };
}

/** The N most recent projects, for the dashboard's activity table. */
export async function listRecentProjects(limit: number): Promise<ProjectListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select(LIST_COLUMNS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as RawListRow[]).map(toListItem);
}

/**
 * Hybrid search.
 *
 * Every call costs one OpenAI embedding, which is why the filter form submits
 * explicitly rather than on keypress.
 */
export async function searchProjects(options: {
  q: string;
  industry?: string | null;
  limit: number;
}): Promise<ProjectSearchResult[]> {
  const supabase = await createClient();

  const embedding = await embedQuery(options.q);

  const { data: hits, error } = await supabase.rpc("search_projects", {
    // See lib/supabase/vector.ts: the generated types expect a string, and
    // both encodings were verified to work against a real PostgREST.
    query_embedding: toVector(embedding),
    query_text: options.q,
    filter_industry: options.industry ?? undefined,
    match_limit: options.limit,
  });

  if (error || !hits || hits.length === 0) return [];

  const typedHits = hits as SearchHit[];
  const ids = typedHits.map((h) => h.project_id);

  const { data } = await supabase
    .from("projects")
    .select(LIST_COLUMNS)
    .in("id", ids)
    .is("deleted_at", null);

  const byId = new Map(
    ((data ?? []) as unknown as RawListRow[]).map((r) => [r.id, toListItem(r)]),
  );

  // PRESERVE RELEVANCE ORDER. The RRF ranking IS the product; re-sorting or
  // iterating `data` instead of `hits` silently destroys it.
  return typedHits.flatMap((hit) => {
    const project = byId.get(hit.project_id);
    if (!project) return [];
    return [{ ...project, snippet: hit.best_snippet, source: hit.best_source }];
  });
}

export async function getProject(id: string) {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      // §15.10: an explicit list, never select("*"). A column missing from
      // here does not fail — it arrives `undefined` and renders as "—", which
      // is a silent wrong answer. Add new project columns HERE.
      "id, title, description, status, industry, industry_confidence, summary, summary_text, created_at, updated_at, created_by, last_updated_by, engagement_type, start_date, end_date, team_size, nda_status",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) return null;

  const [
    { data: documents },
    { data: tagRows },
    { data: people },
    { data: links },
    { data: client },
    { data: features },
    { data: proofPointRows },
  ] = await Promise.all([
      supabase
        .from("documents")
        .select(
          "id, filename, mime, doc_role, status, error, is_synthetic, visibility",
        )
        .eq("project_id", id)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("project_tech_tags")
        .select("tech_tags(id, canonical_name, is_approved)")
        .eq("project_id", id),
      supabase
        .from("profiles")
        .select("id, name, email")
        .in(
          "id",
          [project.created_by, project.last_updated_by].filter(
            (v): v is string => !!v,
          ),
        ),
      supabase
        .from("project_links")
        .select("id, url, title, description")
        .eq("project_id", id)
        .order("created_at", { ascending: true }),
      /*
       * Client information. NO CLAIM CHECK HERE, deliberately — this goes
       * through the USER's client and project_client_select is the boundary.
       * A caller without projects:view-client-info gets zero rows, not an
       * error, so every page can ask unconditionally and render what it may.
       *
       * Doing it this way rather than branching on can() means there is no
       * second copy of the authorization rule to drift out of step with the
       * policy — the separate table is the structural guarantee (0014).
       */
      supabase
        .from("project_client")
        .select("client_name, updated_at")
        .eq("project_id", id)
        .maybeSingle(),
      /*
       * Features delivered (0017).
       *
       * ORDER BY ordinal, NOT created_at. A wipe-and-rebuild inserts every
       * row in ONE statement, so now() is identical across all of them and
       * ordering by it is genuinely non-deterministic. `ordinal` carries the
       * model's most-significant-first judgement and nothing else does.
       */
      supabase
        .from("project_features")
        .select("id, name, description, ordinal")
        .eq("project_id", id)
        .order("ordinal", { ascending: true }),
      /*
       * Proof points (0017). Same ordering rule.
       *
       * The embedded documents(...) is a LEFT join and MUST be treated as
       * one: source_document_id is nullable and ON DELETE SET NULL, so it
       * legitimately resolves to nothing. Flattened to source_label below.
       */
      supabase
        .from("project_proof_points")
        .select(
          "id, claim, metric, evidence_quote, ordinal, documents(filename, is_synthetic)",
        )
        .eq("project_id", id)
        .order("ordinal", { ascending: true }),
    ]);

  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  return {
    // Narrowed here, at the data-access boundary, so no page has to cast.
    project: { ...project, status: asProjectStatus(project.status) },
    documents: (documents ?? []).map(
      (d): DocumentRow => ({ ...d, status: asDocumentStatus(d.status) }),
    ),
    tags: (tagRows ?? [])
      .map((r) => r.tech_tags as unknown as { id: string; canonical_name: string; is_approved: boolean } | null)
      .filter((t): t is NonNullable<typeof t> => !!t),
    createdBy: project.created_by ? byId.get(project.created_by) : null,
    updatedBy: project.last_updated_by ? byId.get(project.last_updated_by) : null,
    links: links ?? [],
    /** Null when the reader lacks projects:view-client-info, or none is set. */
    client: client ?? null,
    /** Ordered by `ordinal`. Array order IS display order; never re-sort. */
    features: (features ?? []) as FeatureRow[],
    proofPoints: (proofPointRows ?? []).map((p): ProofPointRow => {
      const doc = p.documents as unknown as
        | { filename: string; is_synthetic: boolean }
        | null;
      return {
        id: p.id,
        claim: p.claim,
        metric: p.metric,
        evidence_quote: p.evidence_quote,
        ordinal: p.ordinal,
        /*
         * Null is a legal, expected value — the source may have been
         * hard-deleted (ON DELETE SET NULL) or the model may have named a
         * file that matched nothing. Consumers render NO attribution rather
         * than a placeholder that implies a source.
         *
         * "Project description" matches what DocumentList shows for the
         * synthetic row, so the two surfaces agree on what to call it.
         */
        source_label: doc
          ? doc.is_synthetic
            ? "Project description"
            : doc.filename
          : null,
      };
    }),
  };
}
