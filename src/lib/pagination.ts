/**
 * Search-param parsing shared by every paginated list page.
 *
 * NOT `server-only`: these are pure functions over strings, and keeping them
 * importable from anywhere avoids a second copy appearing in a client
 * component later.
 */

export const PER_PAGE_OPTIONS = [10, 25, 50] as const;
export const DEFAULT_PER_PAGE = 10;

/** One window of a list, plus what the pager needs to describe it. */
export type Paged<T> = {
  items: T[];
  total: number;
  /** The page ACTUALLY rendered — see the clamping note at the foot of this file. */
  page: number;
  pageCount: number;
};

/** Narrows `string | string[] | undefined` from searchParams to a string. */
export function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Parses `?page=` and `?per=` defensively.
 *
 * Every hostile input — `?page=-1`, `?page=abc`, `?page=1e999`, `?per=100000`
 * — has to resolve to a sane window, because these values feed `.range()`
 * directly. `Number.isFinite` is the check that matters: `Number("1e999")` is
 * `Infinity`, which survives a `> 0` test and produces `range(Infinity, NaN)`.
 *
 * `perPage` is clamped to the offered options rather than merely bounded, so
 * the Show control always has a matching value and can never render blank.
 */
export function pageParams(searchParams: Record<string, string | string[] | undefined>): {
  page: number;
  perPage: number;
} {
  const rawPage = Number(param(searchParams.page));
  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawPer = Number(param(searchParams.per));
  const perPage = (PER_PAGE_OPTIONS as readonly number[]).includes(rawPer)
    ? rawPer
    : DEFAULT_PER_PAGE;

  return { page, perPage };
}

/*
 * NOTE: there is deliberately no `clampPage` helper here. A page cannot be
 * clamped before its query runs, because the total is not known until then —
 * so the clamp lives inside `listProjects` / `listUsers`, which re-query the
 * last real page when the requested one overshoots. The returned `page` is
 * therefore always the page actually rendered, and the UI can trust it.
 */
