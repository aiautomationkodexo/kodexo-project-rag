import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/chrome/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { StatusChip } from "@/components/ui/status-chip";
import { can, requireClaim } from "@/lib/auth/claims";
import { disclosure } from "@/lib/projects/disclosure";
import { ENGAGEMENT_LABELS, isEngagementType } from "@/lib/projects/validate";
import { linkLabel } from "@/lib/projects/links";
import { NdaForm } from "./nda-form";
import { getProject } from "@/lib/projects/queries";
import { asSummary } from "@/lib/types";
import { formatDate, formatDateRange } from "@/lib/format";
import { DocumentList } from "./document-list";
import { AddFiles } from "./add-files";
import { LiveStatus } from "./live-status";
import { EditForm } from "./edit-form";
import { DeleteProject } from "./delete-project";
import { DerivedTabs, asDerivedTab } from "./derived-tabs";
import { RegenerateProject } from "./regenerate-project";

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

  const {
    project,
    documents,
    tags,
    createdBy,
    updatedBy,
    links,
    client,
    features,
    proofPoints,
  } = data;
  const summary = asSummary(project.summary);
  // Narrowed, never trusted: a stale or hand-edited ?tab= falls back to the
  // summary rather than rendering nothing.
  const tab = asDerivedTab((await props.searchParams).tab as string | undefined);
  const canUpdate = can(user, "projects:update");
  const canSetNda = can(user, "projects:set-nda");
  const d = disclosure(project.nda_status);
  const engagement =
    project.engagement_type && isEngagementType(project.engagement_type)
      ? ENGAGEMENT_LABELS[project.engagement_type]
      : null;

  return (
    <>
      <PageHeader
        kicker="Portfolio"
        title={project.title}
        // The one red run on this view, and PageHeader's single `action`
        // slot is that ration expressed structurally. Gated on 'ready'
        // because regenerateProject rejects anything else — an
        // always-visible button would offer an action that can only fail.
        // That gate is also the rate limit, hence no cooldown column.
        action={
          canUpdate && project.status === "ready" ? (
            <RegenerateProject projectId={project.id} />
          ) : null
        }
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
          {/*
            * The three derived views of one corpus, tabbed. Always mounted,
            * including mid-regenerate: the previous rows are still in the
            * tables (finalizeProject wipes them immediately before the
            * reinsert), so hiding this would blank content that is still
            * valid. `processing` only changes the empty-state copy.
            */}
          <DerivedTabs
            projectId={project.id}
            active={tab}
            summary={summary}
            features={features}
            proofPoints={proofPoints}
            processing={project.status !== "ready"}
          />

          {canUpdate ? (
            <EditForm
              projectId={project.id}
              title={project.title}
              description={project.description ?? ""}
              engagementType={project.engagement_type}
              startDate={project.start_date}
              endDate={project.end_date}
              teamSize={project.team_size}
              // Rendered back in the paste format so an edit round-trips.
              // Title-first matches the parser's `Title — URL` form.
              links={links
                .map((l) => (l.title ? `${l.title} — ${l.url}` : l.url))
                .join("\n")}
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
              <Meta label="Engagement">{engagement ?? "—"}</Meta>
              <Meta label="Dates">
                {formatDateRange(project.start_date, project.end_date)}
              </Meta>
              <Meta label="Team size">{project.team_size ?? "—"}</Meta>
              <Meta label="Disclosure">
                {/* "Not reviewed", not "—": absence has teeth on this field.
                    An em dash reads as "nobody bothered" when it actually
                    means "treat as excluded". */}
                {project.nda_status ?? "Not reviewed"}
                <span className="block text-caption text-n500">
                  {d.mayUseBrand
                    ? d.mayUseClientName
                      ? "Brand and client name may be used"
                      : "Brand may be used; client must not be named"
                    : d.mayUseClientName
                      ? "Client may be named; brand use not permitted"
                      : "Not for external use"}
                </span>
              </Meta>
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
              <DocumentList
                documents={documents}
                projectId={project.id}
                canUpdate={canUpdate}
              />
              {canUpdate ? <AddFiles projectId={project.id} /> : null}
            </CardContent>
          </Card>

          {links.length > 0 ? (
            <Card>
              <CardHeader title="Links" />
              <CardContent className="py-[4px]">
                <ul className="m-0 list-none p-0">
                  {links.map((link) => (
                    <li
                      key={link.id}
                      className="border-b border-n200 py-cell-y last:border-b-0"
                    >
                      {/* rel="noopener noreferrer" is mandatory alongside
                          target="_blank": without noopener the opened page
                          gets a window.opener handle back to ours. */}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-body text-list text-ink underline underline-offset-2 hover:text-red"
                      >
                        {linkLabel(link)}
                      </a>
                      {link.description ? (
                        <span className="block text-caption text-n500">
                          {link.description}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/*
            Client information. `client` is null both when nobody set one AND
            when the viewer lacks projects:view-client-info — the RLS policy on
            project_client returns zero rows rather than erroring, so there is
            no second copy of the authorization rule here to drift out of step
            with the database.
          */}
          {client?.client_name ? (
            <Card>
              <CardHeader
                title="Client"
                description="Restricted. Uploaded documents may still name the client in search results."
              />
              <CardContent className="py-[4px]">
                <Meta label="Client name">{client.client_name}</Meta>
              </CardContent>
            </Card>
          ) : null}

          {canSetNda ? (
            <Card>
              <CardHeader
                title="Disclosure"
                description="Governs whether this project may be named externally."
              />
              <CardContent>
                <NdaForm projectId={project.id} ndaStatus={project.nda_status} />
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
