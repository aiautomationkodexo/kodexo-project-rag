/**
 * The centred empty state from the reference dashboards.
 *
 * This replaces a left-barred Callout. The Callout tier is for a MESSAGE about
 * something that happened (a link expired, search is down); an empty table is
 * a state of the page itself, and rendering it as a notice made "no results
 * yet" look like a warning. Centred in the space the data would have occupied
 * reads as calm, and leaves room for the action that fixes it.
 *
 * The icon medallion is n100 on n50 — the two lowest surface tiers, so it
 * registers as texture rather than as a thing to look at.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-panel-x py-section text-center">
      {icon ? (
        <span className="mb-panel-y flex h-[38px] w-[38px] items-center justify-center rounded-box bg-n100 text-n500">
          {icon}
        </span>
      ) : null}
      <p className="mb-0 font-heading text-subhead font-bold text-ink">{title}</p>
      {body ? (
        <div className="mt-[6px] max-w-prose text-small text-n500">{body}</div>
      ) : null}
      {action ? <div className="mt-panel-y">{action}</div> : null}
    </div>
  );
}
