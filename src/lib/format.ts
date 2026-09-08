/** Presentation helpers. No data access. */

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A `date` column: "2025-03-04". No time, so no timezone. */
function formatDay(iso: string): string {
  // Parsed as UTC by spec for a bare YYYY-MM-DD, then formatted in UTC, so a
  // date never shifts by a day for readers west of the meridian. Constructing
  // `new Date("2025-03-04")` and formatting it LOCALLY is the classic
  // off-by-one here.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * An engagement's span. One string, not two fields: "Mar 2024 — ongoing" is a
 * single fact to a reader, and the details rail is 320px wide.
 */
export function formatDateRange(
  start: string | null,
  end: string | null,
): string {
  if (!start && !end) return "—";
  if (start && !end) return `${formatDay(start)} — ongoing`;
  // An end with no start is legal (0012's CHECK permits it): we may know when
  // something shipped and not when it began.
  if (!start && end) return `until ${formatDay(end)}`;
  return `${formatDay(start!)} — ${formatDay(end!)}`;
}

/**
 * Fallback when the model omits a section label: `client_feedback` →
 * `Client feedback`. §15.12 still applies — this derives a heading from
 * whatever key arrives, it does not enumerate known keys.
 */
export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  if (!words) return "Section";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The search RPC returns `left(chunk_text, 300)` — a raw substring that can
 * start and end mid-sentence, with no highlight markers.
 *
 * Rendering the ellipses as machinery (in n400, so the eye skips them) is what
 * makes a mid-sentence substring read as deliberate rather than broken.
 */
export function trimSnippet(raw: string): {
  text: string;
  leadEllipsis: boolean;
  tailEllipsis: boolean;
} {
  const text = raw.trim();
  return {
    text,
    // Doesn't begin like the start of a sentence or a quotation.
    leadEllipsis: !/^["“([]|^[A-Z0-9]/.test(text),
    // The RPC truncates at exactly 300 chars.
    tailEllipsis: raw.length >= 300,
  };
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
