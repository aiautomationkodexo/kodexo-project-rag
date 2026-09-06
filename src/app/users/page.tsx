import Link from "next/link";
import { AppShell } from "@/components/chrome/app-shell";
import { PageHeader } from "@/components/chrome/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireClaim } from "@/lib/auth/claims";
import { can } from "@/lib/auth/claim-set";
import { listUsers, type UserSort } from "@/lib/users/queries";
import { UserFilterForm } from "./filter-form";
import { UserRow } from "./user-row";

export const dynamic = "force-dynamic";

const LIMITS = [5, 10, 25];
const SORTS: UserSort[] = ["name", "created", "oldest"];

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function UsersPage(props: PageProps<"/users">) {
  const actor = await requireClaim("users:view");
  const searchParams = await props.searchParams;

  const q = param(searchParams.q).trim();
  const rawLimit = Number(param(searchParams.limit));
  const limit = LIMITS.includes(rawLimit) ? rawLimit : 10;
  const rawSort = param(searchParams.sort) as UserSort;
  const sort: UserSort = SORTS.includes(rawSort) ? rawSort : "created";

  const users = await listUsers({ q: q || null, sort, limit });

  return (
    <AppShell>
      <PageHeader
        title="Users"
        action={
          can(actor, "users:create") ? (
            // The view's one red run.
            <Link href="/users/new">
              <Button variant="primary">New user</Button>
            </Link>
          ) : null
        }
      />

      <UserFilterForm q={q} sort={sort} limit={limit} />

      {users.length > 0 ? (
        <div>
          {users.map((user) => (
            <UserRow key={user.id} user={user} />
          ))}
        </div>
      ) : q ? (
        <EmptyState
          title="No users match that search."
          body={
            <Link href="/users" className="underline underline-offset-2">
              Clear search
            </Link>
          }
        />
      ) : (
        <EmptyState title="No users yet." />
      )}
    </AppShell>
  );
}
