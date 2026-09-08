import { Ordinal } from "@/components/ui/ordinal";
import { EmptyState } from "@/components/ui/empty-state";
import { AiBadge } from "@/components/ui/ai-badge";
import type { FeatureRow } from "@/lib/types";

/**
 * Features delivered (0017).
 *
 * ARRAY ORDER IS DISPLAY ORDER — getProject sorted by `ordinal`, which is the
 * model's most-significant-first judgement. A `.sort()` here is a bug for
 * exactly the reason it is one in summary-sections.tsx: the order is not
 * recoverable from any other column, and `created_at` is identical across the
 * batch insert that produced these rows.
 *
 * No `switch`, no `if`, no lookup keyed on a feature's name. The list is
 * unbounded model output and every row renders identically.
 *
 * The badge is per-ROW, not once on the card header: on the header it reads
 * as a note about the section, on each row it reads as a property of each
 * claim, which is what it is.
 */
export function FeaturesList({
  features,
  processing,
}: {
  features: FeatureRow[];
  processing: boolean;
}) {
  if (features.length === 0) {
    return (
      <EmptyState
        title="No features extracted yet."
        body={
          processing
            ? "The feature list is extracted once processing finishes."
            : "The material did not describe features that were delivered. Attach a document that does, then regenerate."
        }
      />
    );
  }

  return (
    <ul className="m-0 list-none space-y-[9px] p-0">
      {features.map((feature, i) => (
        <li
          key={feature.id}
          className="rounded-box border border-n200 px-panel-x py-panel-y"
        >
          <div className="flex flex-wrap items-start justify-between gap-cell-x">
            <span className="min-w-0 flex-1 font-heading text-list font-bold text-ink [overflow-wrap:anywhere]">
              {/* n400, not red: a rationed colour cannot be applied to an
                  unbounded, model-generated run. Same rule as the summary. */}
              <Ordinal n={i + 1} />
              {feature.name}
            </span>
            <AiBadge />
          </div>
          {/* whitespace-pre-line, NOT a markdown parser — same as the summary
              sections. The model is told plain prose; if it emits a `*`
              anyway, it renders as a `*`. */}
          <p className="mt-[4px] mb-0 max-w-prose whitespace-pre-line text-small text-n600">
            {feature.description}
          </p>
        </li>
      ))}
    </ul>
  );
}
