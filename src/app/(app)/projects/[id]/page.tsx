import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/chrome/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { StatusChip } from "@/components/ui/status-chip";
import { can, requireClaim } from "@/lib/auth/claims";
import { getProject } from "@/lib/projects/queries";
import { asSummary } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { SummarySections } from "./summary-sections";
import { DocumentList } from "./document-list";
import { AddFiles } from "./add-files";
import { LiveStatus } from "./live-status";
import { EditForm } from "./edit-form";
import { DeleteProject } from "./delete-project";

export const dynamic = "force-dynamic";

/** A label/value pair in the metadata rail. */
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-n200 py-cell-y last:border-b-0">
      <p className="mb-[2px] font-body text-label font-bold uppercase tracking-label text-n500">
        {label}
      </p>
      <div className="text-list text-ink">{children}</div>
    </div>
  );
}

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const user = await requireClaim("projects:view");
  const { id } = await props.params;

  const data = await getProject(id);
  if (!data) notFound();

  const { project, documents, tags, createdBy, updatedBy } = data;
  const summary = asSummary(project.summary);
  const canUpdate = can(user, "projects:update");

  return (
    <>
      <PageHeader
        kicker="Portfolio"
        title={project.title}
        meta={
          <div className="flex flex-wrap items-center gap-[6px]">
            <StatusChip kind="project" status={project.status} />
            {project.industry ? <Chip tone="invert">{project.industry}</Chip> : null}
          </div>
        }
      />

      <p className="mb-panel-y">
        <Link
          href="/projects"
          className="font-body text-label font-bold uppercase tracking-label text-n600 underline underline-offset-2 hover:text-ink"
        >
          ← All projects
        </Link>
      </p>

      {project.status !== "ready" ? (
        <div className="mb-cell-x">
          <LiveStatus
            projectId={project.id}
            initialStatus={project.status}
            initialDocuments={documents}
          />
        </div>
      ) : null}

      {/*
       * TWO COLUMNS: the summary is the page, everything else is reference.
       *
       * The summary column is capped at the prose measure rather than filling
       * the shell — DESIGN.md's reading measure is the right one for running
       * prose, and a 1400px line of body text is unreadable regardless of how
       * much room the dashboard has. The rail absorbs the rest.
       */}
      <div className="grid gap-cell-x lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-cell-x">
          <Card>
            <CardHeader
              title="Summary"
              description="Generated from the project description and every attached document."
            />
            <CardContent>
              <SummarySections summary={summary} />
            </CardContent>
          </Card>

          {canUpdate ? (
            <EditForm
              projectId={project.id}
              title={project.title}
              description={project.description ?? ""}
            />
          ) : null}

          {can(user, "projects:delete") ? (
            <DeleteProject projectId={project.id} title={project.title} />
          ) : null}
        </div>

        <aside className="space-y-cell-x lg:sticky lg:top-section">
          <Card>
            <CardHeader title="Details" />
            <CardContent className="py-[4px]">
              <Meta label="Status">
                <StatusChip kind="project" status={project.status} />
              </Meta>
              <Meta label="Industry">{project.industry ?? "—"}</Meta>
              <Meta label="Technologies">
                {tags.length === 0 ? (
                  <span className="text-n400">None yet</span>
                ) : (
                  <span className="flex flex-wrap gap-[4px]">
                    {tags.map((tag) => (
                      <Chip
                        key={tag.id}
                        title={tag.is_approved ? undefined : "Pending review"}
                      >
                        {tag.canonical_name}
                        {tag.is_approved ? "" : " *"}
                      </Chip>
                    ))}
                  </span>
                )}
              </Meta>
              <Meta label="Created">
                {formatDate(project.created_at)}
                <span className="block text-caption text-n500">
                  by {createdBy?.name ?? createdBy?.email ?? "unknown"}
                </span>
              </Meta>
              {updatedBy ? (
                <Meta label="Last updated">
                  {formatDate(project.updated_at)}
                  <span className="block text-caption text-n500">
                    by {updatedBy.name ?? updatedBy.email}
                  </span>
                </Meta>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title="Sources"
              description={`${documents.length} ${documents.length === 1 ? "document" : "documents"}`}
            />
            <CardContent>
              <DocumentList documents={documents} />
              {canUpdate ? <AddFiles projectId={project.id} /> : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
