import Link from "next/link";
import { Chip } from "@/components/ui/chip";
import { StatusChip } from "@/components/ui/status-chip";
import { formatDate } from "@/lib/format";
import type { ProjectListItem } from "@/lib/types";

const MAX_TAGS = 4;

export function ProjectRow({ project }: { project: ProjectListItem }) {
  const shown = project.tags.slice(0, MAX_TAGS);
  const overflow = project.tags.length - shown.length;

  return (
    <article className="rule-hair py-panel-y">
      <div className="flex flex-wrap items-baseline justify-between gap-gutter">
        <h2 className="font-display text-subhead font-bold">
          <Link href={`/projects/${project.id}`} className="hover:text-red-deep">
            {project.title}
          </Link>
        </h2>
        <div className="flex items-center gap-[8px]">
          {project.status !== "ready" ? (
            <StatusChip kind="project" status={project.status} />
          ) : null}
          <span className="text-small text-n500">
            {formatDate(project.created_at)}
          </span>
        </div>
      </div>

      {project.summary_text ? (
        <p className="mt-[6px] mb-0 line-clamp-2 max-w-prose text-list text-n500">
          {project.summary_text}
        </p>
      ) : null}

      <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
        {project.industry ? (
          <Chip tone="invert">{project.industry}</Chip>
        ) : null}
        {shown.map((tag) => (
          <Chip
            key={tag.id}
            title={tag.is_approved ? undefined : "Pending review"}
          >
            {tag.canonical_name}
            {tag.is_approved ? "" : " *"}
          </Chip>
        ))}
        {overflow > 0 ? (
          <span className="text-label uppercase tracking-label text-n500">
            +{overflow}
          </span>
        ) : null}
      </div>
    </article>
  );
}
