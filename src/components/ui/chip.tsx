import type { Tone } from "@/lib/types";

const TONES: Record<Tone, string> = {
  neutral: "tone-neutral",
  invert: "tone-invert",
  ok: "tone-ok",
  warn: "tone-warn",
  err: "tone-err",
  info: "tone-info",
};

/**
 * DESIGN.md §5.7's TaggedPair tag recipe, extracted.
 *
 * Colour always arrives via a tone-* utility, which sets background, border
 * AND text together — semantic values are locked sets and mixing across them
 * is forbidden. Passing raw colour classes here is a review failure.
 *
 * PILL RADIUS, not `rounded-box`. Identity v1.0 ships `--radius-pill` and a
 * status badge is the canonical use for it: a fully-round end is what
 * distinguishes a passive label from a button at a glance, which matters here
 * because chips sit inside table cells next to real links. DESIGN.md's
 * "no pills" rule was a print-era constraint and is superseded.
 *
 * The border is drawn so a chip keeps its edge on the `n50` table headers and
 * card grounds this redesign introduced — on white alone the tint sufficed.
 */
export function Chip({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-block rounded-pill border px-[8px] py-[2px] text-label uppercase tracking-tag ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
