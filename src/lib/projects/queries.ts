import "server-only";

import { createClient } from "@/lib/supabase/server";
import { embedQuery } from "@/lib/ai/openai";
import { toVector } from "@/lib/supabase/vector";
import {
  asDocumentStatus,
  asProjectStatus,
  type DocumentRow,
  type ProjectListItem,
  type ProjectSearchResult,
  type SearchHit,
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

export async function listProjects(options: {
  industry?: string | null;
  limit: number;
  sort: "recent" | "oldest";
}): Promise<ProjectListItem[]> {
  const supabase = await createClient();

  let query = supabase
    .from("projects")
    .select(LIST_COLUMNS)
    .is("deleted_at", null)
    .order("created_at", { ascending: options.sort === "oldest" })
    .limit(options.limit);

  if (options.industry) query = query.eq("industry", options.industry);

  const { data } = await query;
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
      "id, title, description, status, industry, industry_confidence, summary, summary_text, created_at, updated_at, created_by, last_updated_by",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) return null;

  const [{ data: documents }, { data: tagRows }, { data: people }] =
    await Promise.all([
      supabase
        .from("documents")
        .select("id, filename, mime, doc_role, status, error, is_synthetic")
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
  };
}
