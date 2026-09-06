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
 * Colour always arrives via a tone-* utility, which sets background AND text
 * together — Tier 3 pairs are locked and mixing halves across pairs is
 * forbidden. Passing raw colour classes here is a review failure.
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
      className={`inline-block rounded-box px-[6px] py-[2px] text-label uppercase tracking-tag ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
