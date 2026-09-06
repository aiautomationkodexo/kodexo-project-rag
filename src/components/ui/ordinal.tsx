/**
 * DESIGN.md §5.8's NumberedStack numeral, extracted: zero-padded, display 800,
 * n400.
 *
 * n400 and NOT red — deliberately. DESIGN.md §9 sanctions "red section
 * numerals" for an app, but principle 1 rations red, and §15.12 guarantees the
 * summary section list is model-generated and unbounded. A rationed colour
 * cannot be applied to an unbounded run: an eleven-section project would put
 * eleven red numerals on one screen. DESIGN.md itself uses n400 for
 * NumberedStack precisely because those numerals repeat.
 */
export function Ordinal({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`mr-[8px] font-display text-[13px] font-extrabold leading-none text-n400 ${className}`}
    >
      {String(n).padStart(2, "0")}
    </span>
  );
}
