import { Ordinal } from "@/components/ui/ordinal";

/**
 * DESIGN.md §5.1 SectionHeading, adapted: display 900 / 20px over a 1.5px n300
 * rule.
 *
 * `action` is a SINGLE slot, not an array. That is the red ration expressed
 * structurally — a view gets one primary action, and there is nowhere to put a
 * second one.
 */
export function PageHeader({
  ordinal,
  title,
  meta,
  action,
}: {
  ordinal?: number;
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="rule-heading mb-panel-y flex flex-wrap items-end justify-between gap-gutter pb-[5px]">
      <div className="min-w-0">
        <h1 className="font-display text-section font-black tracking-title text-ink">
          {ordinal !== undefined ? <Ordinal n={ordinal} /> : null}
          {title}
        </h1>
        {meta ? <div className="mt-[6px]">{meta}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
