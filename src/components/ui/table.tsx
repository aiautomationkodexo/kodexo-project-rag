import type { ThHTMLAttributes, TdHTMLAttributes } from "react";

/**
 * DESIGN.md §5.5 `DocTable`, promoted to the primary list surface.
 *
 * The app previously rendered lists as stacked <article> blocks. That is the
 * print system's habit — a proposal has no rows to compare — and it is why
 * scanning twenty projects meant reading twenty paragraphs. A real table lets
 * the eye run down one column, which is the entire reason dashboards use them.
 *
 * SEMANTICS ARE LOAD-BEARING: real <table>/<th scope>. A grid of divs looks
 * identical and tells a screen reader nothing about which header owns a cell.
 *
 * The wrapper's `overflow-x-auto` is not optional — a six-column table below
 * ~700px must scroll ITSELF rather than widen the document, or the whole page
 * (rail included) gains a horizontal scrollbar.
 *
 * `overflow-hidden` on the vertical axis (implied by `overflow-x-auto`, which
 * sets the other axis to `auto` too) is what CLIPS the tinted `n50` header row
 * to the card's 6px corners. Without it the header's square top corners poke
 * through the card's rounded ones — invisible at the old 2px radius, obvious
 * at the SOT's 6px, and the single most common way a rounded table looks
 * broken.
 */

export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="w-full overflow-x-auto rounded-box">{children}</div>;
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse text-list">{children}</table>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-n200 bg-n50 text-left">{children}</thead>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

/**
 * `hover` is opt-out rather than opt-in: nearly every row in this app links
 * somewhere, and a row that highlights on hover is the cheapest possible
 * affordance for that.
 */
export function TR({
  hover = true,
  children,
}: {
  hover?: boolean;
  children: React.ReactNode;
}) {
  return (
    <tr
      className={`border-b border-n200 last:border-b-0 ${
        hover ? "transition-colors hover:bg-n50" : ""
      }`}
    >
      {children}
    </tr>
  );
}

export function TH({
  className = "",
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-cell-x py-cell-y font-body text-label font-bold uppercase tracking-label text-n600 ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

export function TD({
  className = "",
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={`px-cell-x py-[10px] align-middle text-ink ${className}`}
      {...props}
    >
      {children}
    </td>
  );
}

/** A full-width message row — keeps an empty table inside its own frame. */
export function TEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-cell-x py-section text-center">
        {children}
      </td>
    </tr>
  );
}
