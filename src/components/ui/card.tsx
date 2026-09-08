/**
 * The dashboard surface primitive.
 *
 * A card is a RAISED surface, so it carries `elev-sm` — the smallest of the
 * SOT's three elevations (`0 1px 2px rgba(9,9,11,.04)`), which is a hairline's
 * worth of lift rather than a glow. Border AND shadow together: the border is
 * what still separates the card on a tinted `n50` ground, where a 4%-alpha
 * shadow is invisible.
 *
 * This supersedes DESIGN.md principle 6 ("no shadows, ever"), which existed
 * because the source medium was paper. Identity v1.0 ships the elevation
 * scale; a hand-written `box-shadow` value is still a review failure.
 *
 * `flush` drops the body padding for cards whose content is a table — a table
 * brings its own cell rhythm and double-padding it detaches the header row
 * from the card edge.
 */

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`elev-sm rounded-box border border-n200 bg-white ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-gutter border-b border-n200 px-panel-x py-panel-y">
      <div className="min-w-0">
        <h2 className="font-heading text-subhead font-bold text-ink">{title}</h2>
        {description ? (
          <p className="mt-[2px] mb-0 text-small text-n500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardContent({
  flush = false,
  className = "",
  children,
}: {
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${flush ? "" : "px-panel-x py-panel-y"} ${className}`}>
      {children}
    </div>
  );
}

export function CardFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-gutter border-t border-n200 px-panel-x py-cell-y">
      {children}
    </div>
  );
}
