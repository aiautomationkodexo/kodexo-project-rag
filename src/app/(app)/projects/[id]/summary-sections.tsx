import { Ordinal } from "@/components/ui/ordinal";
import { EmptyState } from "@/components/ui/empty-state";
import { humanizeKey } from "@/lib/format";
import type { Summary } from "@/lib/types";

/**
 * §15.12 LIVES HERE. This is the only component that touches summary.sections.
 *
 * RULES ENFORCED IN REVIEW — all of these are bugs, not preferences:
 *   · No switch, no if, no lookup object keyed on s.key. Not for icons, not
 *     for ordering, not for a "put overview first" nicety. The key set is
 *     model-generated, differs per project, and grows over time.
 *   · Order is ARRAY ORDER, unconditionally. A .sort() here is a bug.
 *   · Never render summary_text — that is the flattened form built for
 *     embedding. Iterate the array.
 *   · whitespace-pre-line, never a markdown parser: prompt rule 7 says plain
 *     prose, and a client testimonial containing * or # would get mangled.
 */
export function SummarySections({ summary }: { summary: Summary | null }) {
  const sections = (summary?.sections ?? []).filter((s) => s?.content?.trim());

  if (sections.length === 0) {
    return (
      <EmptyState
        title="No summary yet."
        body="The summary is generated once processing finishes."
      />
    );
  }

  return (
    <div className="space-y-section">
      {sections.map((section, i) => (
        // Keys are stable slugs, but a model could emit a duplicate; falling
        // back to the index avoids a React crash on malformed data.
        <section key={section.key || i}>
          <h3 className="rule-hair mb-[7px] pb-[5px] font-heading text-subhead font-bold">
            <Ordinal n={i + 1} />
            {/* A missing label degrades to a humanized key rather than blank. */}
            {section.label?.trim() || humanizeKey(section.key)}
          </h3>
          <p className="prose-body mb-0 max-w-prose whitespace-pre-line text-body">
            {section.content.trim()}
          </p>
        </section>
      ))}
    </div>
  );
}
