import { AutoSubmit } from "@/components/ui/auto-submit";
import { Button } from "@/components/ui/button";
import { IconSearch } from "@/components/ui/icon";
import { Input, Select } from "@/components/ui/input";
import { Toolbar, ToolbarField } from "@/components/ui/toolbar";
import { PER_PAGE_OPTIONS } from "@/lib/pagination";

/**
 * A plain GET form. No useRouter, no useSearchParams.
 *
 * The browser serializes every param for free; back/forward and bookmarking
 * work natively; there is no Suspense boundary to add; and `?q=` in the URL is
 * the thing the whole page keys off. The only client code is AutoSubmit's
 * requestSubmit().
 *
 * NEVER debounce-submit on keypress. Each `?q=` render costs one OpenAI
 * embedding call, so live-as-you-type search would multiply the API bill by
 * roughly the length of the query.
 *
 * PAGE IS NOT A FIELD HERE, deliberately. Any change to a filter invalidates
 * the current offset — filtering to 3 results while sitting on page 4 would
 * render an empty table. Omitting `page` from the form means every submit
 * drops it from the query string and lands back on page 1.
 */
export function FilterForm({
  q,
  industry,
  perPage,
  sort,
  industries,
}: {
  q: string;
  industry: string;
  perPage: number;
  sort: string;
  industries: string[];
}) {
  return (
    <form method="get" action="/projects">
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
              placeholder="What was the project about?"
              className="pl-[32px]"
            />
          </div>
        </ToolbarField>

        <AutoSubmit>
          <div className="flex flex-wrap items-end gap-cell-x">
            <ToolbarField label="Industry" htmlFor="industry">
              <Select id="industry" name="industry" defaultValue={industry}>
                <option value="">All</option>
                {industries.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </ToolbarField>

            {/* Not rendered under search: search_projects returns RRF order and
                takes no sort argument, so ?q=…&sort=oldest is uninterpretable.
                Omitting the field means it cannot be submitted at all, rather
                than being submitted and silently ignored. */}
            {q ? null : (
              <ToolbarField label="Sort" htmlFor="sort">
                <Select id="sort" name="sort" defaultValue={sort}>
                  <option value="recent">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </Select>
              </ToolbarField>
            )}

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
