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
 *   focus   = 2px n800 OUTLINE, never a `ring`. Elevation is now allowed
 *             (Identity v1.0 ships three shadows) but focus is still an
 *             outline: `ring-*` compiles to a `box-shadow`, which would then
 *             collide with the card's own `elev-*` on any focused control
 *             inside one. Inherited from :focus-visible.
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
      // `gap-[6px]` rather than a margin on the icon: it applies only when
      // there is more than one child, so an icon-only or text-only button
      // needs no variant and gains no stray space.
      className={`inline-flex items-center justify-center gap-[6px] rounded-box font-body transition-colors disabled:cursor-not-allowed disabled:border-n200 disabled:bg-n100 disabled:text-n400 ${VARIANTS[variant]} ${sizing} ${className}`}
      {...props}
    />
  );
}
