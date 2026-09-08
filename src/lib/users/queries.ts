import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Claim } from "@/lib/auth/claim-set";
import type { Paged } from "@/lib/pagination";

/**
 * IMPORTANT: every query here filters `.is("deleted_at", null)` explicitly.
 *
 * Unlike `projects_select`, the `profiles_select` policy does NOT contain
 * `deleted_at is null` — it references only `profiles.id` and the actor's
 * claims. So RLS will happily return soft-deleted users and the application
 * layer is the only thing hiding them. (That same asymmetry is why profiles
 * need no `soft_delete_*` RPC, unlike projects — see 0006_soft_delete.sql.)
 */

export type UserListItem = {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  created_at: string;
  claims: Claim[];
};

export type UserSort = "name" | "created" | "oldest";

/**
 * A page of users.
 *
 * Mirrors `listProjects`: `.range()` + `{ count: "exact" }`, with the
 * over-range re-query in the same place and for the same reason (the total is
 * not knowable before the query runs, so the caller cannot clamp `?page=`).
 */
export async function listUsers(options: {
  q?: string | null;
  sort: UserSort;
  page: number;
  perPage: number;
}): Promise<Paged<UserListItem>> {
  const supabase = await createClient();

  const run = async (page: number) => {
    const from = (page - 1) * options.perPage;

    let query = supabase
      .from("profiles")
      .select(
        "id, email, name, is_active, is_super_admin, created_at, user_claims(claim)",
        { count: "exact" },
      )
      .is("deleted_at", null)
      .range(from, from + options.perPage - 1);

    if (options.q) {
      // Case-insensitive across both columns. `or` needs the PostgREST syntax.
      const term = options.q.replace(/[%,()]/g, "");
      query = query.or(`email.ilike.%${term}%,name.ilike.%${term}%`);
    }

    query =
      options.sort === "name"
        ? query.order("name", { ascending: true, nullsFirst: false })
        : query.order("created_at", { ascending: options.sort === "oldest" });

    const { data, count } = await query;

    const items = ((data ?? []) as unknown as (Omit<UserListItem, "claims"> & {
      user_claims: { claim: string }[] | null;
    })[]).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      is_active: row.is_active,
      is_super_admin: row.is_super_admin,
      created_at: row.created_at,
      claims: (row.user_claims ?? []).map((c) => c.claim as Claim),
    }));

    return { items, count };
  };

  const first = await run(options.page);
  const pageCount = Math.max(
    1,
    Math.ceil((first.count ?? first.items.length) / options.perPage),
  );

  if (options.page > pageCount) {
    const last = await run(pageCount);
    return {
      items: last.items,
      total: last.count ?? last.items.length,
      page: pageCount,
      pageCount,
    };
  }

  return {
    items: first.items,
    total: first.count ?? first.items.length,
    page: options.page,
    pageCount,
  };
}

export async function getUser(id: string) {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name, is_active, is_super_admin, created_at, updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!profile) return null;

  const { data: claimRows } = await supabase
    .from("user_claims")
    .select("claim")
    .eq("user_id", id);

  return {
    profile,
    claims: new Set((claimRows ?? []).map((r) => r.claim as Claim)),
  };
}

/** How many active super admins remain — drives the UI's "last admin" warning. */
export async function countActiveSuperAdmins(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_super_admin", true)
    .eq("is_active", true)
    .is("deleted_at", null);
  return count ?? 0;
}
