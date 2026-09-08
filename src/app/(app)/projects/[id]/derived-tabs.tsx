import Link from "next/link";
import type { Route } from "next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SummarySections } from "./summary-sections";
import { FeaturesList } from "./features-list";
import { ProofPointsList } from "./proof-points-list";
import type { FeatureRow, ProofPointRow, Summary } from "@/lib/types";

/**
 * The three AI-derived views of one corpus: the summary, the features, the
 * proof points. Tabbed because they are alternatives to each other, not a
 * stack — a reader wants one of them at a time, and three full-width lists
 * stacked pushes the edit form below two screenfuls of model output.
 *
 * ── TABS ARE LINKS, NEVER BUTTONS ─────────────────────────────────────────
 * Same rule pagination follows in this codebase, for the same reasons: the
 * active tab stays bookmarkable and shareable, it survives a refresh and the
 * back button, and it needs no client JavaScript. A useState tab strip would
 * also have to ship all three panels' data to the browser; this renders only
 * the active one.
 *
 * `?tab=summary` is deliberately NOT emitted — summary is the default and the
 * bare URL is its canonical form, exactly as page 1 of a list has no `?page`.
 *
 * ACTIVE IS NOT A RED FILL. n100 surface + ink text + a 2px red bottom edge,
 * which is SidebarLink's active recipe rotated. That 2px sliver is chrome,
 * counted once globally — the view's one red RUN is the Regenerate button in
 * the page header.
 */
export const DERIVED_TABS = ["summary", "features", "proof"] as const;

export type DerivedTab = (typeof DERIVED_TABS)[number];

/**
 * Narrows `?tab=` from the URL. Falls back rather than throwing, matching
 * asProjectStatus and friends: a stale or hand-edited link renders the
 * summary instead of a 500.
 */
export function asDerivedTab(value: string | undefined): DerivedTab {
  return (DERIVED_TABS as readonly string[]).includes(value ?? "")
    ? (value as DerivedTab)
    : "summary";
}

const LABELS: Record<DerivedTab, string> = {
  summary: "Summary",
  features: "Features delivered",
  proof: "Proof points",
};

const DESCRIPTIONS: Record<DerivedTab, string> = {
  summary:
    "Generated from the project description and every attached document.",
  features:
    "Extracted by a language model from the attached material. Not reviewed.",
  /*
   * Says only what is true. OUTCOMES_SYSTEM rule 8 asks the model not to name
   * clients, but that is a mitigation and not a control (0017), so this copy
   * must NOT imply the quotes are anonymised — only that they are verbatim,
   * model-selected and unreviewed.
   */
  proof:
    "Quantified outcomes with the supporting quote, reproduced from the source documents. Extracted by a language model and not reviewed.",
};

export function DerivedTabs({
  projectId,
  active,
  summary,
  features,
  proofPoints,
  processing,
}: {
  projectId: string;
  active: DerivedTab;
  summary: Summary | null;
  features: FeatureRow[];
  proofPoints: ProofPointRow[];
  processing: boolean;
}) {
  return (
    <Card>
      <CardHeader title={LABELS[active]} description={DESCRIPTIONS[active]} />

      <nav
        aria-label="Derived views"
        className="flex flex-wrap gap-[2px] border-b border-n200 px-panel-x"
      >
        {DERIVED_TABS.map((tab) => {
          const isActive = tab === active;
          const href = (
            tab === "summary"
              ? `/projects/${projectId}`
              : `/projects/${projectId}?tab=${tab}`
          ) as Route;

          return (
            <Link
              key={tab}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`relative rounded-t-[6px] px-cell-x py-[7px] font-body text-small transition-colors ${
                isActive
                  ? "bg-n100 font-bold text-ink"
                  : "text-n600 hover:bg-n50 hover:text-ink"
              }`}
            >
              {LABELS[tab]}
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-red"
                />
              ) : null}
            </Link>
          );
        })}
      </nav>

      <CardContent>
        {/* Only the active panel renders — the others are not in the DOM, so
            there is nothing to hide with CSS and nothing shipped unused. */}
        {active === "summary" ? <SummarySections summary={summary} /> : null}
        {active === "features" ? (
          <FeaturesList features={features} processing={processing} />
        ) : null}
        {active === "proof" ? (
          <ProofPointsList proofPoints={proofPoints} processing={processing} />
        ) : null}
      </CardContent>
    </Card>
  );
}
