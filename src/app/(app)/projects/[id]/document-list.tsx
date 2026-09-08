import { StatusChip } from "@/components/ui/status-chip";
import { Chip } from "@/components/ui/chip";
import type { DocumentRow } from "@/lib/types";
import { VisibilityToggle } from "./visibility-toggle";
import { RemoveDocument } from "./remove-document";

function isMedia(mime: string): boolean {
  return mime.startsWith("audio/") || mime.startsWith("video/");
}

/**
 * The name shown in bold, and the caption beneath it — or null when there is
 * no second line worth drawing.
 *
 * `doc_role` is a free-text answer to "What is this document?", so nothing
 * stops a user pasting the filename into it (autofill does this readily, and
 * so does anyone who reads the prompt as "name it"). When that happens the row
 * printed the same string twice, once bold and once grey, which looks like a
 * rendering bug rather than the data it is.
 *
 * The comparison is case-insensitive, trimmed, and also matches the filename
 * with its extension removed — "report.docx" and "report" are the same answer
 * to a human, and only the exact-match case is genuinely rare.
 */
function describe(doc: DocumentRow): { label: string; role: string | null } {
  const label = doc.is_synthetic ? "Project description" : doc.filename;
  const role = doc.doc_role?.trim();
  if (!role) return { label, role: null };

  const norm = (s: string) => s.trim().toLowerCase();
  const withoutExt = label.replace(/\.[^./\\]+$/, "");
  const duplicate = norm(role) === norm(label) || norm(role) === norm(withoutExt);

  return { label, role: duplicate ? null : role };
}

/**
 * DESIGN.md §5.9 PhaseBlock, adapted. Its `first` prop gave the recommended
 * starting phase a heavier 1.5px n800 border; here that treatment marks the
 * document currently PROCESSING — a faithful reuse of "the one that matters
 * right now".
 */
export function DocumentList({
  documents,
  projectId,
  canUpdate = false,
}: {
  documents: DocumentRow[];
  projectId?: string;
  canUpdate?: boolean;
}) {
  if (documents.length === 0) return null;

  return (
    <ul className="list-none space-y-[9px] p-0">
      {documents.map((doc) => {
        const { label, role } = describe(doc);

        return (
          <li
            key={doc.id}
            className={`rounded-box px-panel-x py-panel-y ${
              doc.status === "processing"
                ? "border-[1.5px] border-n800"
                : "border border-n200"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-cell-x">
              <div className="min-w-0 flex-1">
                <span className="block font-body text-list font-bold text-ink [overflow-wrap:anywhere]">
                  {label}
                </span>
                {/* doc_role is free text, rendered verbatim. No enum lookup. */}
                {role ? (
                  <span className="mt-[2px] block text-small text-n500 [overflow-wrap:anywhere]">
                    {role}
                  </span>
                ) : null}
              </div>
              <span className="flex flex-wrap items-center gap-[4px]">
                {/* tone="neutral", NOT warn: warn is deliberately unallocated
                    so "documents failed" keeps its meaning, and an
                    unindexed document is a chosen state, not a problem. */}
                {doc.visibility === "no_index" ? (
                  <Chip title="Stored, but not searchable">Not indexed</Chip>
                ) : null}
                <StatusChip kind="document" status={doc.status} />
              </span>
            </div>

            {doc.status === "failed" && doc.error ? (
              <p className="mt-[6px] mb-0 text-small text-err-ink">{doc.error}</p>
            ) : null}

            {/* A recording sits in 'processing' for minutes rather than the
                seconds a PDF takes, with no progress signal of any kind — the
                work is happening at Deepgram. Saying so is the difference
                between "still going" and "stuck". */}
            {doc.status === "processing" && isMedia(doc.mime) ? (
              <p className="mt-[6px] mb-0 text-small text-n500">
                Transcribing — a long recording can take several minutes.
              </p>
            ) : null}

            {/* The synthetic description document is excluded: it IS the
                project description, so removing it from the index while the
                description still renders on the page would be incoherent. */}
            {/* Two DIFFERENT operations, deliberately side by side:
                  "Remove from index" keeps the document ON the project and
                  only drops it from search; "Remove document" takes it off
                  the project entirely (is_active = false, reversible because
                  §15.2 keeps raw_text). The labels and titles carry that
                  distinction — see remove-document.tsx.

                  The wrapper owns the top margin. It used to live on
                  VisibilityToggle's own <form>, which would now indent one
                  control and not the other. */}
            {canUpdate && projectId && !doc.is_synthetic ? (
              <div className="mt-[6px] flex flex-wrap items-center gap-cell-x">
                <VisibilityToggle
                  projectId={projectId}
                  documentId={doc.id}
                  visibility={doc.visibility}
                />
                <RemoveDocument projectId={projectId} documentId={doc.id} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
