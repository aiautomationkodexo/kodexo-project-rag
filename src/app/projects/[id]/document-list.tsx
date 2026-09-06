import { StatusChip } from "@/components/ui/status-chip";
import type { DocumentRow } from "@/lib/types";

/**
 * DESIGN.md §5.9 PhaseBlock, adapted. Its `first` prop gave the recommended
 * starting phase a heavier 1.5px n800 border; here that treatment marks the
 * document currently PROCESSING — a faithful reuse of "the one that matters
 * right now".
 */
export function DocumentList({ documents }: { documents: DocumentRow[] }) {
  if (documents.length === 0) return null;

  return (
    <ul className="list-none space-y-[9px] p-0">
      {documents.map((doc) => (
        <li
          key={doc.id}
          className={`rounded-box px-panel-x py-panel-y ${
            doc.status === "processing"
              ? "border-[1.5px] border-n800"
              : "border border-n200"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-gutter">
            <div className="min-w-0">
              <span className="font-body text-list font-bold text-ink">
                {doc.is_synthetic ? "Project description" : doc.filename}
              </span>
              {/* doc_role is free text, rendered verbatim. No enum lookup. */}
              {doc.doc_role ? (
                <span className="ml-[8px] text-small text-n500">
                  {doc.doc_role}
                </span>
              ) : null}
            </div>
            <StatusChip kind="document" status={doc.status} />
          </div>

          {doc.status === "failed" && doc.error ? (
            <p className="mt-[6px] mb-0 text-small text-err-ink">{doc.error}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
