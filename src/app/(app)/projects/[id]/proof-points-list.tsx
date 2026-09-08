import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/chip";
import { AiBadge } from "@/components/ui/ai-badge";
import type { ProofPointRow } from "@/lib/types";

/**
 * Proof points (0017): a quantified claim, its metric, and the verbatim quote
 * that evidences it.
 *
 * Array order is display order; a `.sort()` is a bug. See features-list.tsx.
 *
 * ── ⚠ evidence_quote IS VERBATIM CORPUS TEXT ──────────────────────────────
 *
 *   OUTCOMES_SYSTEM rule 8 asks the model never to name a client, company or
 *   brand and to attribute by role. That is a MITIGATION, NOT A CONTROL:
 *   documents.raw_text genuinely contains those names, a verbatim quote is
 *   the highest-risk field for carrying one through, nothing detects a leak,
 *   and THIS COMPONENT is where a leaked name becomes visible.
 *
 *   Consequently no copy here — or on the card that mounts it — may promise
 *   anonymisation. The card description says what is true: these are
 *   model-extracted quotes, reproduced from the sources, unreviewed. Nothing
 *   more. Migration 0017's header states the same limitation on the schema.
 *
 * whitespace-pre-line and NO markdown parser: a verbatim quote containing `*`
 * or `#` must render as typed, not be reinterpreted as emphasis.
 */
export function ProofPointsList({
  proofPoints,
  processing,
}: {
  proofPoints: ProofPointRow[];
  processing: boolean;
}) {
  if (proofPoints.length === 0) {
    return (
      <EmptyState
        title="No proof points extracted yet."
        body={
          processing
            ? "Proof points are extracted once processing finishes."
            : "The material contained no quantified, quotable outcomes. A retrospective or a testimonial is usually where these come from."
        }
      />
    );
  }

  return (
    <ul className="m-0 list-none space-y-[9px] p-0">
      {proofPoints.map((point) => (
        <li
          key={point.id}
          className="rounded-box border border-n200 px-panel-x py-panel-y"
        >
          <div className="flex flex-wrap items-start justify-between gap-cell-x">
            <span className="min-w-0 flex-1 font-body text-list font-bold text-ink [overflow-wrap:anywhere]">
              {point.claim}
            </span>
            <span className="flex shrink-0 flex-wrap items-center gap-[4px]">
              {/* Null for a genuinely qualitative outcome — prompt rule 5
                  says null rather than invent a figure, so an absent metric
                  is the correct value and simply renders nothing. */}
              {point.metric ? <Chip tone="invert">{point.metric}</Chip> : null}
              <AiBadge />
            </span>
          </div>

          {/* The 3px left edge is Callout's bar recipe, reused: this IS a
              quotation set off from the claim above it. A full Callout would
              be too heavy nested inside a list row, and would spend a
              semantic tone on a neutral piece of evidence. */}
          <blockquote className="mt-[6px] mb-0 border-l-[3px] border-n300 pl-panel-x">
            <p className="mb-0 max-w-prose whitespace-pre-line text-small italic text-n600">
              {point.evidence_quote}
            </p>
          </blockquote>

          {/* Omitted ENTIRELY when null, never rendered as "—": the source is
              legitimately absent (ON DELETE SET NULL, or a model-reported
              filename that matched nothing) and an absent attribution must
              not look like a field that failed to load. */}
          {point.source_label ? (
            <p className="mt-[4px] mb-0 text-caption text-n500">
              from {point.source_label}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
