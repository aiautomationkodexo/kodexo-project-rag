import { AutoSubmit } from "@/components/ui/auto-submit";
import { Button } from "@/components/ui/button";
import { IconSearch } from "@/components/ui/icon";
import { Input, Select } from "@/components/ui/input";
import { Toolbar, ToolbarField } from "@/components/ui/toolbar";
import { PER_PAGE_OPTIONS } from "@/lib/pagination";

/**
 * Plain GET form, same idiom as /projects — zero JS beyond AutoSubmit.
 *
 * `page` is deliberately not a field: changing a filter invalidates the
 * current offset, so every submit drops it and returns to page 1.
 */
export function UserFilterForm({
  q,
  sort,
  perPage,
}: {
  q: string;
  sort: string;
  perPage: number;
}) {
  return (
    <form method="get" action="/users">
      <Toolbar>
        <ToolbarField label="Search" htmlFor="q" grow>
          <div className="relative">
            <span className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-n400">
              <IconSearch size={15} />
            </span>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Name or email"
              className="pl-[32px]"
            />
          </div>
        </ToolbarField>

        <AutoSubmit>
          <div className="flex flex-wrap items-end gap-cell-x">
            <ToolbarField label="Sort" htmlFor="sort">
              <Select id="sort" name="sort" defaultValue={sort}>
                <option value="created">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name (A–Z)</option>
              </Select>
            </ToolbarField>

            <ToolbarField label="Show" htmlFor="per">
              <Select id="per" name="per" defaultValue={String(perPage)}>
                {PER_PAGE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </ToolbarField>
          </div>
        </AutoSubmit>

        <Button type="submit">Apply</Button>
      </Toolbar>
    </form>
  );
}
