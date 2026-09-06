/**
 * DESIGN.md §1: KODEXO + red middot + LABS, 800 weight, .2em tracking.
 * The middot is the one piece of chrome red, counted once globally rather than
 * against any single view's ration.
 */
export function Wordmark({ size = "bar" }: { size?: "bar" | "cover" }) {
  return (
    <span
      className={`font-body font-extrabold uppercase tracking-brand text-ink ${
        size === "cover" ? "text-[13px]" : "text-label"
      }`}
    >
      KODEXO
      <em className="not-italic text-red">·</em>
      LABS
    </span>
  );
}
