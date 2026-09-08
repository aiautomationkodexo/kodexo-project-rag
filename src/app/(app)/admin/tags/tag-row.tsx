"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/format";
import { approveTag, mergeTag, type TagActionState } from "./actions";
import type { MergeTarget, UnapprovedTag } from "@/lib/tags/queries";

/**
 * One row of the review queue, carrying PRD §12's two actions and no third.
 *
 * There is deliberately no "reject" or "delete": 0011 revokes DELETE on
 * tech_tags from `authenticated` precisely because a raw delete cascades the
 * tag off every project that carried it, with no repointing and no record.
 * Folding a junk tag into a real one is a merge.
 *
 * Merge is behind a disclosure rather than always-open. A queue of twenty tags
 * with twenty expanded <select>s of ~80 approved tags each is unreadable, and
 * approve is the far more common action.
 */
export function TagRow({
  tag,
  targets,
}: {
  tag: UnapprovedTag;
  targets: MergeTarget[];
}) {
  const [approveState, approveAction] = useActionState<TagActionState, FormData>(
    approveTag,
    {},
  );
  const [mergeState, mergeAction] = useActionState<TagActionState, FormData>(
    mergeTag,
    {},
  );
  const [merging, setMerging] = useState(false);

  const state = mergeState.error || mergeState.ok ? mergeState : approveState;

  return (
    <div className="border-b border-n200 px-panel-x py-panel-y last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-gutter">
        <h3 className="min-w-0 font-heading text-subhead font-bold text-ink">
          {tag.canonical_name}
        </h3>

        <div className="flex items-center gap-cell-x text-caption text-n500">
          <span className="tabular-nums">
            {tag.project_count}{" "}
            {tag.project_count === 1 ? "project" : "projects"}
          </span>
          <span className="tabular-nums">{formatDate(tag.created_at)}</span>
        </div>
      </div>

      {state.error ? (
        <Callout variant="err" label="Could not save" className="mt-panel-y">
          <p className="mb-0">{state.error}</p>
        </Callout>
      ) : null}
      {state.ok ? (
        <Callout variant="ok" label="Done" className="mt-panel-y">
          <p className="mb-0">{state.ok}</p>
        </Callout>
      ) : null}

      <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
        <form action={approveAction}>
          <input type="hidden" name="tagId" value={tag.id} />
          <SubmitButton size="sm" pendingLabel="Approving…">
            Approve
          </SubmitButton>
        </form>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setMerging((open) => !open)}
          aria-expanded={merging}
        >
          {merging ? "Cancel merge" : "Merge into…"}
        </Button>
      </div>

      {merging ? (
        <form action={mergeAction} className="mt-[8px]">
          <input type="hidden" name="sourceId" value={tag.id} />
          <input type="hidden" name="sourceName" value={tag.canonical_name} />

          <label
            htmlFor={`target-${tag.id}`}
            className="mb-[6px] block font-body text-label uppercase tracking-label text-n700"
          >
            Merge into
          </label>

          <div className="flex flex-wrap items-center gap-[8px]">
            <Select
              id={`target-${tag.id}`}
              name="targetId"
              required
              defaultValue=""
              className="max-w-form"
            >
              <option value="" disabled>
                Choose a tag…
              </option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.canonical_name}
                </option>
              ))}
            </Select>

            <SubmitButton size="sm" pendingLabel="Merging…">
              Merge
            </SubmitButton>
          </div>

          <p className="mt-[6px] mb-0 text-small text-n500">
            {tag.canonical_name} is removed, its {tag.project_count}{" "}
            {tag.project_count === 1 ? "project" : "projects"} are repointed, and
            the spelling becomes an alias so it normalises automatically next
            time.
          </p>
        </form>
      ) : null}
    </div>
  );
}
