type Variant = "default" | "warn" | "ok" | "err" | "info";

/**
 * DESIGN.md §5.4, left-barred emphasis block.
 *
 * NOTE the `brand` variant from DESIGN.md is absent, and its absence is
 * enforced by this union type. In print a document has four red uses to spend;
 * in-app there is one per view, and spending it on a passive block that is
 * neither an action nor a state is exactly the misuse principle 1 exists to
 * prevent.
 *
 * COLOUR COMES ENTIRELY FROM `tone-*` NOW. Identity v1.0 makes each semantic
 * colour a triple (bg / border / text), so the bar is the set's own border
 * value — previously it was the INK colour reused as a border, which was a
 * hand-mixed fourth value the palette never defined. The full border is drawn
 * (not just the left edge) so the block still reads as an object on the `n50`
 * grounds this redesign introduced; the 3px left edge keeps the §5.4 bar.
 */
const BARS: Record<Variant, string> = {
  default: "tone-neutral",
  warn: "tone-warn",
  ok: "tone-ok",
  err: "tone-err",
  info: "tone-info",
};

export function Callout({
  variant = "default",
  label,
  children,
  className = "",
}: {
  variant?: Variant;
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-box border border-l-[3px] px-panel-x py-panel-y ${BARS[variant]} ${className}`}
    >
      {label ? (
        <h4 className="mb-[6px] font-body text-label uppercase tracking-callout">
          {label}
        </h4>
      ) : null}
      <div className="text-body leading-body">{children}</div>
    </div>
  );
}
