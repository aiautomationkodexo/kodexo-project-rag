import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The tag review queue (PRD §12 /admin/tags).
 *
 * Reads go through the USER's client so RLS is the boundary here as everywhere
 * else — unapproved_tag_usage carries its own has_claim('tags:manage') check,
 * which is what makes it safe to hand a curator project counts they could not
 * read directly (ptt_select requires 'projects:view').
 */

export type UnapprovedTag = {
  id: string;
  canonical_name: string;
  created_at: string;
  project_count: number;
};

/** Approved tags, as merge destinations. Ordered for a long <select>. */
export type MergeTarget = {
  id: string;
  canonical_name: string;
};

/**
 * The queue, ordered by usage descending — the tag on twelve projects is the
 * one worth resolving first.
 *
 * Errors are surfaced, not swallowed: unlike a list query whose empty state is
 * a reasonable degradation, an empty review queue reads as "nothing to do",
 * which is a materially wrong thing to tell a curator when the query failed.
 */
export async function listUnapprovedTags(): Promise<UnapprovedTag[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unapproved_tag_usage");

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    canonical_name: row.canonical_name,
    created_at: row.created_at,
    project_count: Number(row.project_count),
  }));
}

/**
 * Merge destinations. Approved tags only — merging into an unapproved one would
 * fold a duplicate into something that is itself still under review, and the
 * next merge would have to undo it.
 */
export async function listMergeTargets(): Promise<MergeTarget[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tech_tags")
    .select("id, canonical_name")
    .eq("is_approved", true)
    .order("canonical_name", { ascending: true });

  return data ?? [];
}

/**
 * How many tags await review — the dashboard tile.
 *
 * Counts `tech_tags` directly rather than reusing `unapproved_tag_usage`,
 * which aggregates project counts per tag and would pull the whole queue over
 * the wire to measure its length. `head: true` sends no rows at all.
 *
 * Unlike `listUnapprovedTags`, this SWALLOWS its error and returns 0. The
 * distinction is deliberate: there, an empty queue is a claim about the
 * curator's workload and being wrong misleads them. Here the number sits on a
 * dashboard beside four others, and throwing would take down the whole page
 * over one tile. A viewer without 'tags:manage' never sees it.
 */
export async function countUnapprovedTags(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("tech_tags")
    .select("id", { count: "exact", head: true })
    .eq("is_approved", false);

  if (error) return 0;
  return count ?? 0;
}
