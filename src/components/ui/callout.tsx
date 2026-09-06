type Variant = "default" | "warn" | "ok" | "err" | "info";

/**
 * DESIGN.md §5.4, left-barred emphasis block.
 *
 * NOTE the `brand` variant from DESIGN.md is absent, and its absence is
 * enforced by this union type. In print a document has four red uses to spend;
 * in-app there is one per view, and spending it on a passive block that is
 * neither an action nor a state is exactly the misuse principle 1 exists to
 * prevent.
 */
const BARS: Record<Variant, string> = {
  default: "border-l-n800 tone-neutral",
  warn: "border-l-warn-ink tone-warn",
  ok: "border-l-ok-ink tone-ok",
  err: "border-l-err-ink tone-err",
  info: "border-l-info-ink tone-info",
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
      className={`rounded-box border-l-[3px] px-panel-x py-panel-y ${BARS[variant]} ${className}`}
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
