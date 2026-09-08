import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AiBadge } from "@/components/ui/ai-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import type { CaseStudyRow } from "@/lib/types";

/**
 * The generated case study outline (migration 0018).
 *
 * ── ARRAY ORDER, UNCONDITIONALLY ──────────────────────────────────────────
 * No `.sort()`, no `switch` on `section.key`, no per-key special case. The
 * order is CASE_STUDY_SECTIONS' order, snapshotted into the row at generation
 * time, and this component's job is to render it. Identical discipline to
 * summary-sections.tsx (§15.12) and features-list.tsx — the difference is
 * only that this skeleton is ours rather than the model's, which changes
 * nothing about how it is rendered.
 *
 * ── AN EMPTY SECTION IS STILL RENDERED ────────────────────────────────────
 * Sections with no content are rendered, not skipped: skipping would make a
 * half-empty outline look complete, and the heading itself tells the writer
 * this is a section to fill in.
 */

/** Bytes → a human size. Only ever kB here; a DOCX outline is a few pages. */
function fileSize(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} kB`;
}

export function CaseStudy({
  projectId,
  caseStudy,
  processing,
}: {
  projectId: string;
  caseStudy: CaseStudyRow | null;
  processing: boolean;
}) {
  if (!caseStudy) {
    return (
      <Card>
        <CardHeader
          title="Case study outline"
          description="A downloadable draft, generated from this project's documents."
        />
        <CardContent>
          <EmptyState
            title="No outline generated yet."
            body={
              processing
                ? "The outline is generated once processing finishes."
                : "There was no usable material to draft from. Attach a document, then regenerate."
            }
          />
        </CardContent>
      </Card>
    );
  }

  const { outline } = caseStudy;
  const size = fileSize(caseStudy.size_bytes);

  return (
    <Card>
      <CardHeader
        title="Case study outline"
        description={`Drafted ${formatDate(caseStudy.generated_at)}${
          size ? ` · ${size}` : ""
        }`}
        action={<AiBadge />}
      />
      <CardContent>
        {outline.headline ? (
          <p className="mt-0 mb-panel-y max-w-prose font-heading text-list text-ink">
            {outline.headline}
          </p>
        ) : null}

        {/*
          * The download.
          *
          * A PLAIN LINK, not a button and not a form: it is a GET that
          * navigates, so it must stay right-clickable, middle-clickable and
          * bookmarkable. Same reasoning as the pagination controls, which are
          * links for the same reason.
          *
          * NOT `target="_blank"`. The route answers with a 302 to a signed
          * URL carrying a download disposition, so the browser saves the file
          * and never navigates the current page away — a new tab would open
          * and immediately close itself.
          *
          * The red ration is NOT spent here: PageHeader's Regenerate action
          * already holds this view's single red run, so this is the `default`
          * treatment. A second red control on the page would break the rule
          * whichever one "deserved" it more.
          */}
        {caseStudy.storage_key ? (
          <p className="mt-0 mb-panel-y">
            <a
              href={`/projects/${projectId}/case-study/download`}
              className="inline-flex items-center gap-[6px] rounded-box border border-n200 bg-white px-panel-x py-cell-y font-body text-small font-bold text-ink transition-colors hover:border-n300"
            >
              Download outline (.docx)
            </a>
          </p>
        ) : (
          /*
           * storage_key is null: the generation succeeded but the upload did
           * not (0018). The outline below is still real and still useful, so
           * this says what is unavailable rather than hiding the section.
           * tone stays neutral — the next regenerate retries the upload, and
           * this is not a state anyone must act on.
           */
          <p className="mt-0 mb-panel-y text-small text-n600">
            The file could not be stored on the last attempt. The outline below
            is complete; regenerate to produce a downloadable copy.
          </p>
        )}

        <ol className="m-0 list-none space-y-[9px] p-0">
          {outline.sections.map((section) => {
            const content = section.content.trim();
            return (
              <li
                key={section.key}
                className="rounded-box border border-n200 px-panel-x py-panel-y"
              >
                <h4 className="mt-0 mb-[4px] font-heading text-list font-bold text-ink">
                  {section.label}
                </h4>

                {content ? (
                  // whitespace-pre-line, NOT a markdown parser — identical to
                  // the summary sections and the feature descriptions.
                  <p className="mt-0 mb-0 max-w-prose whitespace-pre-line text-small text-n600">
                    {content}
                  </p>
                ) : (
                  <p className="mt-0 mb-0 max-w-prose text-small text-n400">
                    Nothing in the project material covers this yet.
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
