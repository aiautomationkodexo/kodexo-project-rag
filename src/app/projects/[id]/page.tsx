import { notFound } from "next/navigation";
import { AppShell } from "@/components/chrome/app-shell";
import { PageHeader } from "@/components/chrome/page-header";
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

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const user = await requireClaim("projects:view");
  const { id } = await props.params;

  const data = await getProject(id);
  if (!data) notFound();

  const { project, documents, tags, createdBy, updatedBy } = data;
  const summary = asSummary(project.summary);

  return (
    <AppShell>
      <PageHeader
        title={project.title}
        meta={
          <div className="flex flex-wrap items-center gap-[6px]">
            {project.industry ? (
              <Chip tone="invert">{project.industry}</Chip>
            ) : null}
            {tags.map((tag) => (
              <Chip
                key={tag.id}
                title={tag.is_approved ? undefined : "Pending review"}
              >
                {tag.canonical_name}
                {tag.is_approved ? "" : " *"}
              </Chip>
            ))}
            {project.status === "ready" ? null : (
              <StatusChip kind="project" status={project.status} />
            )}
          </div>
        }
      />

      {project.status !== "ready" ? (
        <LiveStatus
          projectId={project.id}
          initialStatus={project.status}
          initialDocuments={documents}
        />
      ) : null}

      <SummarySections summary={summary} />

      <section className="mt-section">
        <h2 className="rule-hair mb-panel-y pb-[5px] font-display text-subhead font-bold">
          Sources
        </h2>
        <DocumentList documents={documents} />
        {can(user, "projects:update") ? (
          <AddFiles projectId={project.id} />
        ) : null}
      </section>

      {/* DESIGN.md §5.11 SignOff, adapted: top hairline, display name, n500
          meta lines. The structure fits the record footer exactly. */}
      <footer className="mt-section border-t border-n200 pt-panel-y">
        <p className="mb-0 text-small text-n500">
          Created by {createdBy?.name ?? createdBy?.email ?? "unknown"} on{" "}
          {formatDate(project.created_at)}
          {updatedBy ? (
            <>
              {" · "}Last updated by {updatedBy.name ?? updatedBy.email} on{" "}
              {formatDate(project.updated_at)}
            </>
          ) : null}
        </p>
      </footer>

      {can(user, "projects:update") ? (
        <EditForm
          projectId={project.id}
          title={project.title}
          description={project.description ?? ""}
        />
      ) : null}

      {can(user, "projects:delete") ? (
        <DeleteProject projectId={project.id} title={project.title} />
      ) : null}
    </AppShell>
  );
}
