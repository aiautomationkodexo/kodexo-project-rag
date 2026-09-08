import { Ordinal } from "@/components/ui/ordinal";

/**
 * DESIGN.md §5.1 SectionHeading, adapted for the dashboard shell.
 *
 * THE KICKER is Visual Identity v1.0's `.mono-kicker` — JetBrains Mono, 12px,
 * .12em, uppercase. Mono is the point: it is the identity's "engineered" tell,
 * and it is what the reference dashboards' OVERVIEW / INVENTORY labels are. It
 * earns its place by naming the SECTION while the title names the PAGE, which
 * lets someone landing mid-app orient without reading the rail.
 *
 * THE TITLE is the STATEMENT face (Unbounded 900) — set globally on `h1`, so
 * this component does not name a family at all.
 *
 * THE RULE IS GONE. In print, a 1.5px n300 rule under every heading separates
 * it from body copy on a page with no other structure. Here the content below
 * is a bordered card that draws its own top edge, so the rule stacked a second
 * hairline against it. Space does the separating instead.
 *
 * `action` remains a SINGLE slot, not an array — the red ration expressed
 * structurally. A view gets one primary action and there is nowhere to put a
 * second.
 */
export function PageHeader({
  kicker,
  ordinal,
  title,
  description,
  meta,
  action,
}: {
  kicker?: string;
  ordinal?: number;
  title: string;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-section flex flex-wrap items-start justify-between gap-gutter">
      <div className="min-w-0">
        {kicker ? (
          <p className="kicker mb-2">{kicker}</p>
        ) : null}
        <h1 className="text-section text-ink">
          {ordinal !== undefined ? <Ordinal n={ordinal} /> : null}
          {title}
        </h1>
        {description ? (
          <p className="mt-[6px] mb-0 max-w-prose text-small text-n500">
            {description}
          </p>
        ) : null}
        {meta ? <div className="mt-[8px]">{meta}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
