import { Chip } from "@/components/ui/chip";

/**
 * The permanent provenance label on every AI-extracted row (0017).
 *
 * "Unreviewed" is a STATEMENT OF FACT, not a workflow state. There is no
 * review action, no `is_reviewed` column and no way to make this badge go
 * away — deliberately. It says "a language model wrote this and nobody
 * checked it", which stays true for the lifetime of the row because every
 * finalize wipes and rebuilds these lists from scratch.
 *
 * ⚠ DO NOT add an "Approve" affordance next to this. The rows are destroyed
 *   and recreated on the next regenerate, so an approval would be silently
 *   discarded — a control that implies an effect it does not have, which is
 *   the same mistake 0016 declined to make with the four-value visibility
 *   vocabulary.
 *
 * tone="neutral", NOT warn — and this is the reasoned choice, not a default:
 *
 *   `tone-warn` is deliberately unallocated in this design system so
 *   "documents failed" keeps its meaning. Every row of both lists on every
 *   project carries this badge, so an amber one would appear constantly as a
 *   routine label and stop reading as "something is wrong". Unreviewed AI
 *   output is the EXPECTED state of these rows, not a problem to fix.
 *
 *   Neutral also matches the precedent already in the codebase: an
 *   unapproved tech tag renders as a neutral Chip with a "Pending review"
 *   title, not a coloured badge (see the project page's Technologies row).
 */
export function AiBadge() {
  return (
    <Chip title="Extracted by a language model. Not reviewed by a person.">
      AI · Unreviewed
    </Chip>
  );
}
