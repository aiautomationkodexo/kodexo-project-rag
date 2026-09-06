import { AutoSubmit } from "@/components/ui/auto-submit";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

/** Plain GET form, same idiom as /projects — zero JS beyond AutoSubmit. */
export function UserFilterForm({
  q,
  sort,
  limit,
}: {
  q: string;
  sort: string;
  limit: number;
}) {
  return (
    <form
      method="get"
      action="/users"
      className="mb-section flex flex-wrap items-end gap-gutter"
    >
      <div className="min-w-[240px] flex-1">
        <label
          htmlFor="q"
          className="mb-[6px] block font-body text-label uppercase tracking-label text-n700"
        >
          Search
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Name or email"
        />
      </div>

      <AutoSubmit>
        <div className="flex flex-wrap items-end gap-gutter">
          <div>
            <label
              htmlFor="sort"
              className="mb-[6px] block font-body text-label uppercase tracking-label text-n700"
            >
              Sort
            </label>
            <Select id="sort" name="sort" defaultValue={sort}>
              <option value="created">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name (A–Z)</option>
            </Select>
          </div>
          <div>
            <label
              htmlFor="limit"
              className="mb-[6px] block font-body text-label uppercase tracking-label text-n700"
            >
              Show
            </label>
            <Select id="limit" name="limit" defaultValue={String(limit)}>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="25">25</option>
            </Select>
          </div>
        </div>
      </AutoSubmit>

      <Button type="submit">Apply</Button>
    </form>
  );
}
