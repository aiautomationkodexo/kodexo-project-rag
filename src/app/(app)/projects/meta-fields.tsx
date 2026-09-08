"use client";

import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import {
  ENGAGEMENT_TYPES,
  ENGAGEMENT_LABELS,
  type FieldErrors,
} from "@/lib/projects/validate";

/**
 * The Part D metadata fields, shared by the create and edit forms so the two
 * cannot drift. There is no shared project-form component in this app — the
 * create and edit forms are separate by design (one has a dropzone, one does
 * not) — so this is the seam that keeps the field set in one place.
 *
 * Every field is UNCONTROLLED (`defaultValue`, no useState). None of them
 * feeds a live counter the way `description` does, so state would be pure
 * cost. The `id` prefix keeps htmlFor unique when both forms are in one DOM.
 */
export function MetaFields({
  idPrefix,
  errors,
  engagementType,
  startDate,
  endDate,
  teamSize,
}: {
  idPrefix: string;
  errors?: FieldErrors;
  engagementType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  teamSize?: number | null;
}) {
  return (
    <div className="grid gap-x-gutter sm:grid-cols-2">
      <Field
        label="Engagement type"
        htmlFor={`${idPrefix}-engagement-type`}
        error={errors?.engagementType}
      >
        <Select
          id={`${idPrefix}-engagement-type`}
          name="engagement_type"
          defaultValue={engagementType ?? ""}
        >
          <option value="">Not specified</option>
          {ENGAGEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ENGAGEMENT_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Team size"
        htmlFor={`${idPrefix}-team-size`}
        error={errors?.teamSize}
      >
        {/* type="number" gives a numeric keypad and the browser's own step
            validation; min mirrors the CHECK. Still re-validated server-side —
            the action reads FormData, not the DOM. */}
        <Input
          id={`${idPrefix}-team-size`}
          name="team_size"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          placeholder="4"
          defaultValue={teamSize ?? ""}
        />
      </Field>

      <Field
        label="Start date"
        htmlFor={`${idPrefix}-start-date`}
        error={errors?.startDate}
      >
        {/* Native date input: there is no picker component, and the native
            control is fully keyboard accessible, gets the platform picker on
            mobile, and inherits `Input`'s tokens for free. */}
        <Input
          id={`${idPrefix}-start-date`}
          name="start_date"
          type="date"
          defaultValue={startDate ?? ""}
        />
      </Field>

      <Field
        label="End date"
        htmlFor={`${idPrefix}-end-date`}
        error={errors?.endDate}
        hint={
          <span className="font-body text-label uppercase tracking-label text-n700">
            Blank if ongoing
          </span>
        }
      >
        {/* The hint is doing real work: an empty native date input gives no
            signal that blank is a legal answer. */}
        <Input
          id={`${idPrefix}-end-date`}
          name="end_date"
          type="date"
          defaultValue={endDate ?? ""}
        />
      </Field>
    </div>
  );
}
