import { AutoSubmit } from "@/components/ui/auto-submit";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

/**
 * A plain GET form. No useRouter, no useSearchParams.
 *
 * The browser serializes all four params for free; back/forward and
 * bookmarking work natively; there is no Suspense boundary to add; and `?q=` in
 * the URL is the thing the whole page keys off. The only client code is
 * AutoSubmit's requestSubmit().
 *
 * NEVER debounce-submit on keypress. Each `?q=` render costs one OpenAI
 * embedding call, so live-as-you-type search would multiply the API bill by
 * roughly the length of the query.
 */
export function FilterForm({
  q,
  industry,
  limit,
  sort,
  industries,
}: {
  q: string;
  industry: string;
  limit: number;
  sort: string;
  industries: string[];
}) {
  return (
    <form
      method="get"
      action="/projects"
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
          placeholder="What was the project about?"
        />
      </div>

      <AutoSubmit>
        <div className="flex flex-wrap items-end gap-gutter">
          <div>
            <label
              htmlFor="industry"
              className="mb-[6px] block font-body text-label uppercase tracking-label text-n700"
            >
              Industry
            </label>
            <Select id="industry" name="industry" defaultValue={industry}>
              <option value="">All</option>
              {industries.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
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

          {/* Not rendered under search: search_projects returns RRF order and
              takes no sort argument, so ?q=…&sort=oldest is uninterpretable.
              Omitting the field means it cannot be submitted at all, rather
              than being submitted and silently ignored. */}
          {q ? null : (
            <div>
              <label
                htmlFor="sort"
                className="mb-[6px] block font-body text-label uppercase tracking-label text-n700"
              >
                Sort
              </label>
              <Select id="sort" name="sort" defaultValue={sort}>
                <option value="recent">Newest first</option>
                <option value="oldest">Oldest first</option>
              </Select>
            </div>
          )}
        </div>
      </AutoSubmit>

      <Button type="submit">Apply</Button>
    </form>
  );
}
