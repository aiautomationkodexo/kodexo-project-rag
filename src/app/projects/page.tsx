import Link from "next/link";
import { AppShell } from "@/components/chrome/app-shell";
import { PageHeader } from "@/components/chrome/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { can, requireClaim } from "@/lib/auth/claims";
import { listIndustries, listProjects, searchProjects } from "@/lib/projects/queries";
import { FilterForm } from "./filter-form";
import { ProjectRow } from "./project-row";
import { SearchResult } from "./search-result";

// Authed surface: never statically prerendered, never ISR.
export const dynamic = "force-dynamic";

const LIMITS = [5, 10, 25];

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function ProjectsPage(props: PageProps<"/projects">) {
  const user = await requireClaim("projects:view");
  const searchParams = await props.searchParams;

  const q = param(searchParams.q).trim();
  const industry = param(searchParams.industry);
  const forbidden = param(searchParams.error) === "forbidden";

  const rawLimit = Number(param(searchParams.limit));
  const limit = LIMITS.includes(rawLimit) ? rawLimit : 10;
  const sort = param(searchParams.sort) === "oldest" ? "oldest" : "recent";

  const industries = await listIndustries();

  let searchFailed = false;
  let results: Awaited<ReturnType<typeof searchProjects>> = [];
  let projects: Awaited<ReturnType<typeof listProjects>> = [];

  if (q) {
    try {
      results = await searchProjects({ q, industry: industry || null, limit });
    } catch (error) {
      // Almost always a missing or rejected OPENAI_API_KEY. Say so plainly
      // rather than rendering an empty state that implies "no matches".
      console.error("[search]", error);
      searchFailed = true;
    }
  } else {
    projects = await listProjects({ industry: industry || null, limit, sort });
  }

  return (
    <AppShell>
      <PageHeader
        title="Projects"
        meta={
          q ? (
            <span className="text-label uppercase tracking-label text-n700">
              Ranked by relevance
            </span>
          ) : null
        }
        action={
          can(user, "projects:create") ? (
            // The view's one red run.
            <Link href="/projects/new">
              <Button variant="primary">New project</Button>
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
        limit={limit}
        sort={sort}
        industries={industries}
      />

      {searchFailed ? (
        <Callout variant="err" label="Search unavailable">
          <p className="mb-0">
            The search index could not be queried. This usually means
            <code className="mx-[4px] font-mono text-small">OPENAI_API_KEY</code>
            is missing or invalid.
          </p>
        </Callout>
      ) : q ? (
        results.length > 0 ? (
          <div>
            {results.map((project, i) => (
              <SearchResult key={project.id} rank={i + 1} project={project} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No strong matches for that search."
            body={
              <>
                The similarity floor is deliberate — weak results are not padded
                in.{" "}
                <Link href="/projects" className="underline underline-offset-2">
                  Clear search
                </Link>
              </>
            }
          />
        )
      ) : projects.length > 0 ? (
        <div>
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </div>
      ) : industry ? (
        <EmptyState
          title="No projects match these filters."
          body={
            <Link href="/projects" className="underline underline-offset-2">
              Clear filters
            </Link>
          }
        />
      ) : (
        <EmptyState
          title="No projects yet."
          body="Add the first one to start building the knowledge base."
          action={
            can(user, "projects:create") ? (
              // `default`, not `primary`: the header button above is already
              // this view's one red run (DESIGN.md principle 1). Repeating the
              // same action in the empty state must not spend the ration twice.
              <Link href="/projects/new">
                <Button>New project</Button>
              </Link>
            ) : null
          }
        />
      )}
    </AppShell>
  );
}
