import Link from "next/link";
import { PageHeader } from "@/components/chrome/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconInbox,
  IconPlus,
  IconProjects,
  IconTags,
} from "@/components/ui/icon";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TBody, TD, TEmpty, TH, THead, TR, TableWrap } from "@/components/ui/table";
import { can, requireProjectAccess } from "@/lib/auth/claims";
import { formatDate } from "@/lib/format";
import { getPortfolioStats, listRecentProjects } from "@/lib/projects/queries";
import { countUnapprovedTags } from "@/lib/tags/queries";

export const dynamic = "force-dynamic";

const RECENT_LIMIT = 8;

/**
 * The overview the app never had — `/` used to redirect straight to a list.
 *
 * Its job is to answer "is the portfolio healthy and what changed" before the
 * user has to pick a page. Everything on it is a link into the surface that
 * can act on it; a number you cannot follow is a number nobody uses.
 *
 * THE RED RATION is spent on "New project" in the header. Every stat tile and
 * every row link below is neutral, and the failed-documents tile tints only
 * its VALUE with err-ink (see stat-card.tsx) — a locked Tier 3 pair used for a
 * genuine problem state, which is exactly what that tier is for.
 */
export default async function DashboardPage() {
  const user = await requireProjectAccess();
  const showTags = can(user, "tags:manage");

  // Independent reads, so one round trip's latency rather than three.
  const [stats, recent, pendingTags] = await Promise.all([
    getPortfolioStats(),
    listRecentProjects(RECENT_LIMIT),
    showTags ? countUnapprovedTags() : Promise.resolve(0),
  ]);

  const firstName = user.name?.trim().split(/\s+/)[0];

  return (
    <>
      <PageHeader
        kicker="Overview"
        title="Dashboard"
        description={
          firstName
            ? `Welcome back, ${firstName}. Here is the state of the portfolio.`
            : "The state of the portfolio at a glance."
        }
        action={
          can(user, "projects:create") ? (
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

      <StatGrid>
        <StatCard
          label="Total projects"
          value={stats.total}
          icon={<IconProjects />}
          href="/projects"
        />
        <StatCard
          label="Ready"
          value={stats.ready}
          hint="Summarised and searchable"
          icon={<IconCheck />}
          tone={stats.ready > 0 ? "ok" : "default"}
        />
        <StatCard
          label="Processing"
          value={stats.processing}
          hint="Awaiting a summary"
          icon={<IconClock />}
        />
        <StatCard
          label="Failed documents"
          value={stats.failedDocuments}
          hint={stats.failedDocuments > 0 ? "Needs attention" : "None"}
          icon={<IconAlert />}
          tone={stats.failedDocuments > 0 ? "err" : "default"}
        />
        {showTags ? (
          <StatCard
            label="Tags to review"
            value={pendingTags}
            hint={pendingTags > 0 ? "Approve or merge" : "Queue clear"}
            icon={<IconTags />}
            href="/admin/tags"
          />
        ) : null}
      </StatGrid>

      <div className="mt-section">
        <Card>
          <CardHeader
            title="Recent projects"
            description="The most recently added work."
            action={
              <Link
                href="/projects"
                className="font-body text-label font-bold uppercase tracking-label text-n600 underline underline-offset-2 hover:text-ink"
              >
                View all
              </Link>
            }
          />
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
                  {recent.length === 0 ? (
                    <TEmpty colSpan={5}>
                      <EmptyState
                        icon={<IconInbox />}
                        title="No projects yet."
                        body="Add the first one to start building the knowledge base."
                        action={
                          can(user, "projects:create") ? (
                            // `default`, not `primary` — the header button above
                            // is already this view's one red run.
                            <Link href="/projects/new">
                              <Button>New project</Button>
                            </Link>
                          ) : null
                        }
                      />
                    </TEmpty>
                  ) : (
                    recent.map((project) => (
                      <TR key={project.id}>
                        <TD className="max-w-[380px]">
                          <Link
                            href={`/projects/${project.id}`}
                            className="font-bold text-ink hover:text-red-deep"
                          >
                            {project.title}
                          </Link>
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
                                <Chip key={tag.id}>{tag.canonical_name}</Chip>
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
                  )}
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
