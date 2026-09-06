/**
 * Text chunking (PRD §10).
 *
 * Uniform across content types by design. Do NOT add special handling for
 * testimonials, transcripts or any other category — search is content-agnostic
 * (PRD §6), and a client's words in a testimonial must rank the same way as a
 * technical paragraph in a design doc.
 *
 * Pure and dependency-free, so it is directly unit-testable.
 */

/** ~800 tokens. */
export const TARGET = 3200;
/** ~15% overlap, so a fact spanning a boundary survives in one piece. */
export const OVERLAP = 480;
/** Below this a chunk is noise — a heading fragment or a stray line. */
export const MIN_CHUNK = 30;

export function chunkText(input: string): string[] {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).filter((p) => p.trim());
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed.length >= MIN_CHUNK) chunks.push(trimmed);
    current = "";
  };

  for (const paragraph of paragraphs) {
    // A single paragraph larger than the target gets hard-split with an
    // OVERLAP stride.
    if (paragraph.length > TARGET) {
      flush();
      const stride = TARGET - OVERLAP;
      for (let i = 0; i < paragraph.length; i += stride) {
        const slice = paragraph.slice(i, i + TARGET).trim();
        if (slice.length >= MIN_CHUNK) chunks.push(slice);
        // Avoid emitting a tiny trailing remnant already covered by the overlap.
        if (i + TARGET >= paragraph.length) break;
      }
      continue;
    }

    if (current && current.length + paragraph.length + 2 > TARGET) {
      const tail = current.slice(-OVERLAP);
      flush();
      // Carry the tail of the previous chunk forward as the overlap.
      current = tail.trimStart();
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  flush();
  return chunks;
}
