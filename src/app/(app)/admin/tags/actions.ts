"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, assertClaim } from "@/lib/auth/claims";
import { writeAudit } from "@/lib/audit/write";

export type TagActionState = {
  error?: string;
  ok?: string;
};

/**
 * Approve an unapproved tag — it is a real technology, not a duplicate.
 *
 * No RPC, deliberately. 0006 needed soft_delete_project only because
 * projects_select filters `deleted_at is null`, so writing that column made the
 * post-image fail the SELECT policy and Postgres rejected the writer's own row.
 * That pathology needs the written column to appear in a policy predicate, and
 * `is_approved` appears in none: tags_select is is_active_user(), tags_write is
 * has_claim(). One row, one table, one statement — already atomic.
 *
 * The USER's client, never the admin client: tags_write IS the authorization
 * check, and 0011's `grant update (is_approved)` is what stops this same call
 * from rewriting canonical_name. The admin client would bypass both.
 */
export async function approveTag(
  _prev: TagActionState,
  formData: FormData,
): Promise<TagActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "Your session has expired. Sign in again." };

  try {
    assertClaim(actor, "tags:manage");
  } catch {
    return { error: "You do not have permission to manage tags." };
  }

  const tagId = String(formData.get("tagId") ?? "");
  if (!tagId) return { error: "Missing tag id." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tech_tags")
    .update({ is_approved: true })
    .eq("id", tagId)
    .select("canonical_name")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "That tag no longer exists." };

  await writeAudit({
    actorId: actor.id,
    action: "tech_tag.approve",
    entityType: "tech_tag",
    entityId: tagId,
    meta: { canonical_name: data.canonical_name },
  });

  revalidatePath("/admin/tags");
  return { ok: `Approved ${data.canonical_name}.` };
}

/**
 * Fold a duplicate spelling into an existing tag.
 *
 * Everything of consequence happens inside merge_tech_tag (0011): the row lock
 * that stops a concurrent finalize from losing a project's tag entirely, the
 * conflict-guarded repoint, the alias that makes the same variant normalise
 * next time, and the audit row — all in one transaction. Do not reimplement any
 * of it here as PostgREST calls; four sequential requests cannot be rolled back
 * and a failure halfway leaves a half-merged taxonomy.
 *
 * The USER's client, because the RPC reads auth.uid() for its own claim check.
 * Called with the admin client it would see a null uid and refuse.
 */
export async function mergeTag(
  _prev: TagActionState,
  formData: FormData,
): Promise<TagActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "Your session has expired. Sign in again." };

  try {
    assertClaim(actor, "tags:manage");
  } catch {
    return { error: "You do not have permission to manage tags." };
  }

  const sourceId = String(formData.get("sourceId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  if (!sourceId) return { error: "Missing tag id." };
  if (!targetId) return { error: "Choose a tag to merge into." };
  if (sourceId === targetId) {
    return { error: "A tag cannot be merged into itself." };
  }

  const sourceName = String(formData.get("sourceName") ?? "").trim();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_tech_tag", {
    p_source: sourceId,
    p_target: targetId,
  });

  // Surfaced raw. The RPC's own messages ("Missing permission: tags:manage",
  // "Cannot merge a tech tag into itself") are already the right words, and
  // rewriting them here would put a second copy of the rules out of step with
  // the migration.
  if (error) return { error: error.message };

  revalidatePath("/admin/tags");
  revalidatePath("/projects");

  const moved = data ?? 0;
  return {
    ok:
      `Merged${sourceName ? ` ${sourceName}` : ""}. ` +
      `${moved} ${moved === 1 ? "project" : "projects"} repointed.`,
  };
}
