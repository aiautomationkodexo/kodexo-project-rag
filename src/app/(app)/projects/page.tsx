import Link from "next/link";
import { PageHeader } from "@/components/chrome/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { IconInbox, IconPlus, IconSearch } from "@/components/ui/icon";
import { Pagination } from "@/components/ui/pagination";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TBody, TD, TEmpty, TH, THead, TR, TableWrap } from "@/components/ui/table";
import { can, requireClaim } from "@/lib/auth/claims";
import { formatDate } from "@/lib/format";
import { listIndustries, listProjects, searchProjects } from "@/lib/projects/queries";
import { pageParams, param } from "@/lib/pagination";
import { FilterForm } from "./filter-form";
import { SearchResult } from "./search-result";

// Authed surface: never statically prerendered, never ISR.
export const dynamic = "force-dynamic";

export default async function ProjectsPage(props: PageProps<"/projects">) {
  const user = await requireClaim("projects:view");
  const searchParams = await props.searchParams;

  const q = param(searchParams.q).trim();
  const industry = param(searchParams.industry);
  const forbidden = param(searchParams.error) === "forbidden";
  const { page, perPage } = pageParams(searchParams);
  const sort = param(searchParams.sort) === "oldest" ? "oldest" : "recent";

  const industries = await listIndustries();

  let searchFailed = false;
  let results: Awaited<ReturnType<typeof searchProjects>> = [];
  let paged: Awaited<ReturnType<typeof listProjects>> | null = null;

  if (q) {
    try {
      // Search is NOT paginated: search_projects takes a single match_limit
      // and returns RRF order, so there is no stable offset to page through.
      // `perPage` doubles as "how many results to ask for".
      results = await searchProjects({ q, industry: industry || null, limit: perPage });
    } catch (error) {
      // Almost always a missing or rejected OPENAI_API_KEY. Say so plainly
      // rather than rendering an empty state that implies "no matches".
      console.error("[search]", error);
      searchFailed = true;
    }
  } else {
    paged = await listProjects({
      industry: industry || null,
      page,
      perPage,
      sort,
    });
  }

  const canCreate = can(user, "projects:create");

  return (
    <>
      <PageHeader
        kicker="Portfolio"
        title="Projects"
        description="Every delivered project, searchable by meaning rather than keyword."
        meta={
          q ? (
            <span className="text-label font-bold uppercase tracking-label text-n700">
              Ranked by relevance
            </span>
          ) : null
        }
        action={
          canCreate ? (
            // The view's one red run.
            <Link href="/projects/new">
              <Button variant="primary">
                <IconPlus size={14} />
                New project
              </Button>
            </Link>
          ) : null
        }
      />

      {forbidden ? (
        <Callout variant="warn" label="Not permitted" className="mb-section">
          <p className="mb-0">You do not have access to that page.</p>
        </Callout>
      ) : null}

      <FilterForm
        q={q}
        industry={industry}
        perPage={perPage}
        sort={sort}
        industries={industries}
      />

      {searchFailed ? (
        <Card>
          <CardContent>
            <Callout variant="err" label="Search unavailable">
              <p className="mb-0">
                The search index could not be queried. This usually means
                <code className="mx-[4px] font-mono text-small">OPENAI_API_KEY</code>
                is missing or invalid.
              </p>
            </Callout>
          </CardContent>
        </Card>
      ) : q ? (
        /*
         * SEARCH RESULTS KEEP THE ARTICLE LAYOUT, not the table.
         *
         * A table row shows metadata; a search result has to show the EVIDENCE
         * — the matched snippet in context — and that does not fit a cell. The
         * ranked-article form is also what carries the rank ordinal and the
         * source attribution, which are the only two honest relevance signals
         * this app has (the RRF score is never rendered).
         */
        <Card>
          <CardContent flush>
            {results.length > 0 ? (
              <div className="px-panel-x">
                {results.map((project, i) => (
                  <SearchResult key={project.id} rank={i + 1} project={project} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<IconSearch />}
                title="No strong matches for that search."
                body={
                  <>
                    The similarity floor is deliberate — weak results are not
                    padded in.{" "}
                    <Link href="/projects" className="underline underline-offset-2">
                      Clear search
                    </Link>
                  </>
                }
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent flush>
            <TableWrap>
              <Table>
                <THead>
                  <TR hover={false}>
                    <TH>Project</TH>
                    <TH>Industry</TH>
                    <TH>Status</TH>
                    <TH>Technologies</TH>
                    <TH className="text-right">Added</TH>
                  </TR>
                </THead>
                <TBody>
                  {paged && paged.items.length > 0 ? (
                    paged.items.map((project) => (
                      <TR key={project.id}>
                        <TD className="max-w-[420px]">
                          <Link
                            href={`/projects/${project.id}`}
                            className="font-bold text-ink hover:text-red-deep"
                          >
                            {project.title}
                          </Link>
                          {project.summary_text ? (
                            <p className="mt-[2px] mb-0 line-clamp-1 text-caption text-n500">
                              {project.summary_text}
                            </p>
                          ) : null}
                        </TD>
                        <TD className="text-n500">{project.industry ?? "—"}</TD>
                        <TD>
                          <StatusChip kind="project" status={project.status} />
                        </TD>
                        <TD>
                          {project.tags.length === 0 ? (
                            <span className="text-n400">—</span>
                          ) : (
                            <span className="flex flex-wrap gap-[4px]">
                              {project.tags.slice(0, 3).map((tag) => (
                                <Chip
                                  key={tag.id}
                                  title={tag.is_approved ? undefined : "Pending review"}
                                >
                                  {tag.canonical_name}
                                  {tag.is_approved ? "" : " *"}
                                </Chip>
                              ))}
                              {project.tags.length > 3 ? (
                                <span className="text-label uppercase tracking-label text-n500">
                                  +{project.tags.length - 3}
                                </span>
                              ) : null}
                            </span>
                          )}
                        </TD>
                        <TD className="whitespace-nowrap text-right text-n500 tabular-nums">
                          {formatDate(project.created_at)}
                        </TD>
                      </TR>
                    ))
                  ) : (
                    <TEmpty colSpan={5}>
                      {industry ? (
                        <EmptyState
                          icon={<IconSearch />}
                          title="No projects match these filters."
                          body={
                            <Link href="/projects" className="underline underline-offset-2">
                              Clear filters
                            </Link>
                          }
                        />
                      ) : (
                        <EmptyState
                          icon={<IconInbox />}
                          title="No projects yet."
                          body="Add the first one to start building the knowledge base."
                          action={
                            canCreate ? (
                              // `default`, not `primary`: the header button
                              // above is already this view's one red run
                              // (DESIGN.md principle 1). Repeating the same
                              // action must not spend the ration twice.
                              <Link href="/projects/new">
                                <Button>New project</Button>
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

          {paged && paged.total > 0 ? (
            <CardFooter>
              <Pagination
                basePath="/projects"
                params={{ industry, sort: sort === "recent" ? undefined : sort, per: perPage }}
                page={paged.page}
                pageCount={paged.pageCount}
                total={paged.total}
                noun="projects"
              />
            </CardFooter>
          ) : null}
        </Card>
      )}
    </>
  );
}
