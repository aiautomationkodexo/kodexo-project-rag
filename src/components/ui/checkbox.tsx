import type { InputHTMLAttributes } from "react";

/**
 * DESIGN.md specifies no form controls at all — it is a print system. This is
 * derived, using the same rules recorded in button.tsx:
 *   box       14px square · 1px n300 border · rounded-box
 *   accent    --color-ink, NOT red. A claims grid renders eight of these at
 *             once; red checkboxes would blow the view's single red run in one
 *             component. Red stays on the primary action.
 *   disabled  n400 accent + n400 label + not-allowed cursor, with `title`
 *             carrying the reason (a disabled control with no explanation is
 *             just a broken control).
 *   focus     inherited `outline` from :focus-visible. Never a ring —
 *             focus:ring-* compiles to box-shadow, and principle 6 forbids
 *             shadows.
 *   hit area  the <label> wraps the input, so the whole row is clickable.
 */
export function Checkbox({
  label,
  hint,
  disabled,
  title,
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label
      title={title}
      className={`flex items-start gap-[8px] py-[3px] ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      } ${className}`}
    >
      <input
        type="checkbox"
        disabled={disabled}
        className={`mt-[2px] h-[14px] w-[14px] shrink-0 rounded-box border border-n300 ${
          disabled ? "accent-n400" : "accent-ink"
        }`}
        {...props}
      />
      <span className="min-w-0">
        <span
          className={`block text-list ${disabled ? "text-n400" : "text-ink"}`}
        >
          {label}
        </span>
        {hint ? (
          <span className="block font-mono text-small text-n500">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}
