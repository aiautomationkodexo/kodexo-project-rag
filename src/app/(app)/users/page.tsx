import Link from "next/link";
import { PageHeader } from "@/components/chrome/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlus, IconSearch, IconUsers } from "@/components/ui/icon";
import { Pagination } from "@/components/ui/pagination";
import { Table, TBody, TD, TEmpty, TH, THead, TR, TableWrap } from "@/components/ui/table";
import { requireClaim } from "@/lib/auth/claims";
import { can, CLAIM_LABELS } from "@/lib/auth/claim-set";
import { formatDate } from "@/lib/format";
import { listUsers, type UserSort } from "@/lib/users/queries";
import { pageParams, param } from "@/lib/pagination";
import { UserFilterForm } from "./filter-form";

export const dynamic = "force-dynamic";

const SORTS: UserSort[] = ["name", "created", "oldest"];
const MAX_CLAIMS = 3;

export default async function UsersPage(props: PageProps<"/users">) {
  const actor = await requireClaim("users:view");
  const searchParams = await props.searchParams;

  const q = param(searchParams.q).trim();
  const { page, perPage } = pageParams(searchParams);
  const rawSort = param(searchParams.sort) as UserSort;
  const sort: UserSort = SORTS.includes(rawSort) ? rawSort : "created";

  const paged = await listUsers({ q: q || null, sort, page, perPage });
  const canCreate = can(actor, "users:create");

  return (
    <>
      <PageHeader
        kicker="People"
        title="Users"
        description="Who can sign in, and what each of them is permitted to do."
        action={
          canCreate ? (
            // The view's one red run.
            <Link href="/users/new">
              <Button variant="primary">
                <IconPlus size={14} />
                New user
              </Button>
            </Link>
          ) : null
        }
      />

      <UserFilterForm q={q} sort={sort} perPage={perPage} />

      <Card>
        <CardContent flush>
          <TableWrap>
            <Table>
              <THead>
                <TR hover={false}>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Permissions</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Added</TH>
                </TR>
              </THead>
              <TBody>
                {paged.items.length > 0 ? (
                  paged.items.map((user) => {
                    // A super admin holds every claim implicitly and has no
                    // user_claims rows — listing "0 permissions" for them
                    // would be actively misleading.
                    const shown = user.claims.slice(0, MAX_CLAIMS);
                    const overflow = user.claims.length - shown.length;

                    return (
                      <TR key={user.id}>
                        <TD>
                          <Link
                            href={`/users/${user.id}`}
                            className="font-bold text-ink hover:text-red-deep"
                          >
                            {user.name?.trim() || user.email}
                          </Link>
                        </TD>
                        <TD className="font-mono text-caption text-n500">
                          {user.email}
                        </TD>
                        <TD>
                          {user.is_super_admin ? (
                            <Chip tone="invert" title="Holds every permission implicitly">
                              Super admin
                            </Chip>
                          ) : shown.length > 0 ? (
                            <span className="flex flex-wrap gap-[4px]">
                              {shown.map((claim) => (
                                <Chip key={claim} title={CLAIM_LABELS[claim]}>
                                  {claim}
                                </Chip>
                              ))}
                              {overflow > 0 ? (
                                <span className="text-label uppercase tracking-label text-n500">
                                  +{overflow}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-label uppercase tracking-label text-n500">
                              None
                            </span>
                          )}
                        </TD>
                        <TD>
                          {user.is_active ? (
                            <Chip tone="ok">Active</Chip>
                          ) : (
                            <Chip tone="neutral">Inactive</Chip>
                          )}
                        </TD>
                        <TD className="whitespace-nowrap text-right text-n500 tabular-nums">
                          {formatDate(user.created_at)}
                        </TD>
                      </TR>
                    );
                  })
                ) : (
                  <TEmpty colSpan={5}>
                    {q ? (
                      <EmptyState
                        icon={<IconSearch />}
                        title="No users match that search."
                        body={
                          <Link href="/users" className="underline underline-offset-2">
                            Clear search
                          </Link>
                        }
                      />
                    ) : (
                      <EmptyState
                        icon={<IconUsers />}
                        title="No users yet."
                        body="Accounts are created by an administrator — there is no self-service sign-up."
                        action={
                          canCreate ? (
                            <Link href="/users/new">
                              <Button>New user</Button>
                            </Link>
                          ) : null
                        }
                      />
                    )}
                  </TEmpty>
                )}
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>

        {paged.total > 0 ? (
          <CardFooter>
            <Pagination
              basePath="/users"
              params={{
                q,
                sort: sort === "created" ? undefined : sort,
                per: perPage,
              }}
              page={paged.page}
              pageCount={paged.pageCount}
              total={paged.total}
              noun="users"
            />
          </CardFooter>
        ) : null}
      </Card>
    </>
  );
}
