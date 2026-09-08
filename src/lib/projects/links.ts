/**
 * Parses the links textarea: one link per line.
 *
 * Three accepted forms, checked in this order:
 *   [Title](https://example.com)     markdown
 *   Title — https://example.com      title, separator, URL (— – - | :)
 *   https://example.com              bare
 *
 * A line with no URL is IGNORED, not an error. The field is free text that
 * people paste into, and rejecting the whole form because one line was a
 * heading would be worse than dropping the heading.
 *
 * Pure and total — no fetching, ever. See migration 0015 for why (SSRF).
 */

/**
 * Nothing else bounds this. MAX_FILES_PER_PROJECT caps documents, but a
 * pasted block is unbounded and each line is a free INSERT.
 */
export const MAX_LINKS_PER_PROJECT = 50;

export type ParsedLink = {
  url: string;
  /** Null when the line carried no title; the UI then shows the domain. */
  title: string | null;
};

/**
 * Matches a bare http(s) URL. Deliberately restrictive:
 *
 * - http/https ONLY. `javascript:`, `data:` and `file:` are the reason — these
 *   strings end up in an href, and a stored `javascript:` URL is stored XSS.
 * - No scheme-relative `//host` and no bare `example.com`: guessing a scheme
 *   means writing a URL the user did not type.
 */
const URL_RE = /https?:\/\/[^\s<>()[\]{}'"]+/i;

/** `[Title](url)` — title captured lazily so `](` inside a title still works. */
const MARKDOWN_RE = /^\[(.*?)\]\((.+?)\)$/;

/**
 * Title/URL separators, longest first so an em dash is not consumed by the
 * hyphen alternative. A bare hyphen is included because people type it, at the
 * cost of splitting a hyphenated title — acceptable, since the URL is the part
 * that must survive and it is matched independently.
 */
const SEPARATOR_RE = /\s+(?:—|–|\||:|-)\s+/;

/** Trailing punctuation from prose, not part of the URL. */
function trimUrl(url: string): string {
  return url.replace(/[.,;:!?)\]}'"]+$/, "");
}

function clean(title: string): string | null {
  const t = title.trim();
  return t.length > 0 ? t : null;
}

export function parseLinks(input: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  const seen = new Set<string>();

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let url: string | null = null;
    let title: string | null = null;

    const md = line.match(MARKDOWN_RE);
    if (md) {
      const candidate = (md[2] ?? "").trim().match(URL_RE);
      if (candidate) {
        url = trimUrl(candidate[0]);
        title = clean(md[1] ?? "");
      }
    }

    if (!url) {
      const found = line.match(URL_RE);
      if (!found) continue; // no URL on this line — ignore it

      url = trimUrl(found[0]);

      // A title only counts if it sits BEFORE the URL and a separator
      // divides them. Text after a URL is a note, not a title.
      const before = line.slice(0, found.index ?? 0);
      const parts = before.split(SEPARATOR_RE);
      // split() leaves a trailing "" when `before` ends in the separator.
      if (parts.length > 1 && parts[parts.length - 1] === "") {
        title = clean(parts.slice(0, -1).join(" "));
      } else if (before.trim() && parts.length > 1) {
        title = clean(parts.slice(0, -1).join(" "));
      }
    }

    if (!url) continue;

    // First occurrence wins, so a titled line is not replaced by a later
    // bare paste of the same URL.
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ url, title });
  }

  return out;
}

/**
 * The display label for a link with no title: the host, minus `www.`.
 * Falls back to the raw URL when it will not parse — never throws, because
 * this runs in render.
 */
export function linkLabel(link: ParsedLink | { url: string; title: string | null }): string {
  if (link.title) return link.title;
  try {
    return new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}
