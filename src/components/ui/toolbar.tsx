/**
 * The filter strip above a table.
 *
 * The old filter form was four loose controls floating on the page background
 * with a submit button trailing them. Grouping them into one bordered strip
 * that sits directly on top of the table's card is what makes the pair read as
 * "controls FOR this table" rather than "some controls, then some data".
 *
 * SEPARATED, NOT WELDED. Under the old 2px radius the strip could sit flush
 * on the table card with `-mb-px` and a squared bottom edge, reading as one
 * object. At the SOT's 6px that trick fails: the strip's square bottom corners
 * collide with the card's rounded top ones and leave two visible notches.
 *
 * So the toolbar is now its own rounded card with a real gap beneath it —
 * which is also how shadcn composes a filter bar over a table. It stays
 * unelevated on purpose: it is a control surface, not a raised one, and giving
 * it the same `elev-sm` as the table card would make the two compete.
 */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-cell-x flex flex-wrap items-end gap-cell-x rounded-box border border-n200 bg-n50 px-panel-x py-panel-y">
      {children}
    </div>
  );
}

/** A labelled control inside a Toolbar. `grow` is for the search box. */
export function ToolbarField({
  label,
  htmlFor,
  grow = false,
  children,
}: {
  label: string;
  htmlFor: string;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={grow ? "min-w-[220px] flex-1" : "min-w-[130px]"}>
      <label
        htmlFor={htmlFor}
        className="mb-[4px] block font-body text-label font-bold uppercase tracking-label text-n600"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
