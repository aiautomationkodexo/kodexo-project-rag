import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "default" | "ghost" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
};

/**
 * DESIGN.md has no form controls at all — it is a print system. Everything
 * here is DERIVED, using rules recorded so they stay reviewable:
 *   border  = 1px n300 (the "rule" tier — a control is more than a divider)
 *   radius  = --radius-box (2px, everywhere, no exceptions)
 *   padding = the table cell measure, 8px 11px
 *   focus   = 2px n800 OUTLINE, never a ring (ring-* compiles to box-shadow,
 *             and principle 6 forbids shadows) — inherited from :focus-visible
 *
 * RED RATION: `primary` is the only red-filled variant, and a view gets ONE.
 * `danger` is deliberately NOT red-filled — destructive actions are rare and
 * spending the ration on them would leave nothing for the real primary action.
 */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-red text-white border border-red hover:bg-red-deep hover:border-red-deep",
  // Lifted verbatim from DESIGN.md §6's document-viewer button.
  default: "bg-white text-ink border border-n200 hover:border-n300",
  ghost: "bg-transparent text-n700 border border-transparent hover:text-ink",
  danger: "bg-white text-err-ink border border-n300 hover:border-err-ink",
};

export function Button({
  variant = "default",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const sizing =
    size === "sm"
      ? "px-cell-x py-[4px] text-label uppercase tracking-label"
      : "px-panel-x py-cell-y text-small font-bold";

  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-box font-body transition-colors disabled:cursor-not-allowed disabled:border-n200 disabled:bg-n100 disabled:text-n400 ${VARIANTS[variant]} ${sizing} ${className}`}
      {...props}
    />
  );
}
