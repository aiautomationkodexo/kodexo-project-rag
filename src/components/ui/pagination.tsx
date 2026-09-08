import Link from "next/link";
import type { Route } from "next";
import { IconChevronLeft, IconChevronRight } from "./icon";

/**
 * Page N of M, with prev/next.
 *
 * LINKS, NOT BUTTONS. Paging is navigation: it must be middle-clickable,
 * bookmarkable and in the back-history. That also keeps this a server
 * component with no client JS at all.
 *
 * An exhausted direction renders as a disabled <span>, not a <Link> to the
 * same page. A link that goes nowhere is a keyboard-focusable dead end, and
 * `aria-disabled` on an anchor still lets it be activated.
 */

function buildHref(
  basePath: string,
  params: Record<string, string | number | undefined>,
  page: number,
): Route {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== null) {
      search.set(key, String(value));
    }
  }
  // Page 1 is the canonical bare URL — no ?page=1 clutter in the address bar,
  // and one URL per result set rather than two.
  if (page > 1) search.set("page", String(page));
  const qs = search.toString();
  return (qs ? `${basePath}?${qs}` : basePath) as Route;
}

const STEP =
  "inline-flex items-center gap-[6px] rounded-box border px-cell-x py-[4px] font-body text-label font-bold uppercase tracking-label transition-colors";

export function Pagination({
  basePath,
  params,
  page,
  pageCount,
  total,
  noun = "results",
}: {
  basePath: string;
  params: Record<string, string | number | undefined>;
  page: number;
  pageCount: number;
  total: number;
  noun?: string;
}) {
  if (pageCount <= 1) {
    return (
      <p className="mb-0 text-caption text-n500">
        <span className="tabular-nums">{total}</span> {noun}
      </p>
    );
  }

  const hasPrev = page > 1;
  const hasNext = page < pageCount;

  return (
    <>
      <p className="mb-0 text-caption text-n500">
        Page <span className="tabular-nums">{page}</span> of{" "}
        <span className="tabular-nums">{pageCount}</span> ·{" "}
        <span className="tabular-nums">{total}</span> {noun}
      </p>

      <nav aria-label="Pagination" className="flex items-center gap-[6px]">
        {hasPrev ? (
          <Link
            href={buildHref(basePath, params, page - 1)}
            rel="prev"
            className={`${STEP} border-n300 bg-white text-ink hover:border-n800`}
          >
            <IconChevronLeft size={13} />
            Prev
          </Link>
        ) : (
          <span aria-disabled="true" className={`${STEP} border-n200 bg-n100 text-n400`}>
            <IconChevronLeft size={13} />
            Prev
          </span>
        )}

        {hasNext ? (
          <Link
            href={buildHref(basePath, params, page + 1)}
            rel="next"
            className={`${STEP} border-n300 bg-white text-ink hover:border-n800`}
          >
            Next
            <IconChevronRight size={13} />
          </Link>
        ) : (
          <span aria-disabled="true" className={`${STEP} border-n200 bg-n100 text-n400`}>
            Next
            <IconChevronRight size={13} />
          </span>
        )}
      </nav>
    </>
  );
}
