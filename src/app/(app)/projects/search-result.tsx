import Link from "next/link";
import { Chip } from "@/components/ui/chip";
import { Ordinal } from "@/components/ui/ordinal";
import { formatDate, trimSnippet } from "@/lib/format";
import type { ProjectSearchResult } from "@/lib/types";

/**
 * A ranked search result.
 *
 * NO HIGHLIGHTING, deliberately. RRF fuses a vector list and a full-text list,
 * so a top result can come ENTIRELY from the vector side and share zero words
 * with the query — that is precisely T4's acceptance criterion. Highlighting
 * nothing on the best result while highlighting stopwords on a worse one would
 * tell the user the opposite of the truth about why the ranking is what it is.
 *
 * SCORE IS NEVER RENDERED. It is an RRF sum in the 0.008–0.033 range; any
 * percentage, bar or star built from it fabricates a calibration that does not
 * exist. The two honest signals are the page-level "Ranked by relevance" label
 * and this row's rank ordinal.
 */
export function SearchResult({
  rank,
  project,
}: {
  rank: number;
  project: ProjectSearchResult;
}) {
  const { text, leadEllipsis, tailEllipsis } = trimSnippet(project.snippet);
  // The RPC coalesces the synthetic document to the literal 'description';
  // rendering that in mono would read as a file named "description".
  const fromDescription = project.source === "description";

  return (
    <article className="rule-hair py-panel-y">
      <div className="flex flex-wrap items-baseline justify-between gap-gutter">
        <h2 className="font-heading text-subhead font-bold">
          <Ordinal n={rank} />
          <Link href={`/projects/${project.id}`} className="hover:text-red-deep">
            {project.title}
          </Link>
        </h2>
        <span className="text-small text-n500">
          {formatDate(project.created_at)}
        </span>
      </div>

      {project.industry ? (
        <div className="mt-[6px]">
          <Chip tone="invert">{project.industry}</Chip>
        </div>
      ) : null}

      {/* Quoted evidence, treated as such: n50 sits behind n100 panels in the
          surface hierarchy, which is the right depth for supporting material. */}
      <blockquote className="mt-[8px] border-l-2 border-n300 bg-n50 px-panel-x py-panel-y">
        <p className="mb-0 line-clamp-3 max-w-prose text-body text-ink [overflow-wrap:anywhere] [text-wrap:pretty]">
          {/* Ellipses are machinery — n400 so the eye skips them. This is what
              makes a mid-sentence substring feel deliberate, not broken. */}
          {leadEllipsis ? <span className="text-n400">… </span> : null}
          {text}
          {tailEllipsis ? <span className="text-n400"> …</span> : null}
        </p>
      </blockquote>

      <p className="mt-[6px] mb-0 flex items-baseline gap-[8px]">
        <span className="text-label uppercase tracking-label text-n700">
          Source
        </span>
        {fromDescription ? (
          <span className="text-small text-n700">Project description</span>
        ) : (
          <span className="font-mono text-small text-n700">{project.source}</span>
        )}
      </p>
    </article>
  );
}
