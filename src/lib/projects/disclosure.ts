/**
 * NDA status → what may actually be said about a project.
 *
 * This is the ONLY place the NDA vocabulary is interpreted. Every consumer
 * asks for the two booleans; nobody switches on the status string itself.
 * A second interpretation site is how the summariser and a future MCP layer
 * end up disagreeing about whether a client may be named.
 *
 * ── FAIL CLOSED ────────────────────────────────────────────────────────────
 * The `default` arm returns {false, false}, so NULL, 'Select', 'Needs Review',
 * a value added to the SQL CHECK but not here, and any garbage all resolve to
 * "say nothing". A project with no NDA answer behaves exactly like
 * 'Permanently Excluded' until a human decides otherwise.
 *
 * This is why the switch returns from every arm rather than assigning to a
 * mutable default: there is no code path that can fall through to a
 * permissive value, and adding a status to NDA_STATUSES without adding it
 * here yields non-disclosable rather than silently disclosable.
 */

/**
 * The vocabulary, verbatim. MUST match the CHECK in
 * supabase/migrations/0013_nda_status.sql byte for byte — the em dashes are
 * U+2014, not hyphens. tests/disclosure.test.mts parses the migration and
 * asserts set equality, because a mismatch means the form offers a value the
 * database rejects.
 */
export const NDA_STATUSES = [
  "Brand Name Use + Client Name Use",
  "Brand Name Use Only",
  "Client Name Use Only",
  "Nothing Can Be Used",
  "NDA Hold — Nothing Can Be Used",
  "Pending BD/Legal Clearance",
  "Permanently Excluded",
  "Internal Only — Never External",
  "Needs Review",
  "Select",
] as const;

export type NdaStatus = (typeof NDA_STATUSES)[number];

export function isNdaStatus(value: string): value is NdaStatus {
  return (NDA_STATUSES as readonly string[]).includes(value);
}

export type Disclosure = {
  /** May we say we did this work — our own brand, case studies, the site. */
  mayUseBrand: boolean;
  /** May we name the client. Strictly narrower; never true when brand is false. */
  mayUseClientName: boolean;
};

/**
 * The two derived booleans. Pure, total, and the single source of truth.
 *
 * Takes `string | null` rather than `NdaStatus` on purpose: the caller is
 * usually holding the raw column, which the type generator emits as `string`
 * because the constraint is a CHECK and not a Postgres enum. Narrowing here
 * rather than at every call site is the point.
 */
export function disclosure(status: string | null): Disclosure {
  switch (status) {
    case "Brand Name Use + Client Name Use":
      return { mayUseBrand: true, mayUseClientName: true };

    case "Brand Name Use Only":
      return { mayUseBrand: true, mayUseClientName: false };

    // Narrower than it reads: naming the client is permitted, but describing
    // the engagement under our own brand is not. Both flags are reported as
    // given rather than "corrected" to a combination that seems more sensible.
    case "Client Name Use Only":
      return { mayUseBrand: false, mayUseClientName: true };

    // Every remaining vocabulary entry is non-disclosable, and they are listed
    // explicitly rather than left to `default` so that a reader can confirm
    // the mapping is complete without cross-referencing the migration.
    case "Nothing Can Be Used":
    case "NDA Hold — Nothing Can Be Used":
    case "Pending BD/Legal Clearance":
    case "Permanently Excluded":
    case "Internal Only — Never External":
    case "Needs Review":
    case "Select":
      return { mayUseBrand: false, mayUseClientName: false };

    // NULL, and anything the vocabulary does not contain. See FAIL CLOSED.
    default:
      return { mayUseBrand: false, mayUseClientName: false };
  }
}

/**
 * True when a project may appear in any externally-facing surface at all.
 *
 * Not simply `mayUseBrand` — kept as its own named predicate because
 * 'Client Name Use Only' permits naming the client while withholding brand
 * use, and a future MCP layer asking "can this leave the building?" wants one
 * answer rather than a boolean expression it has to assemble correctly.
 */
export function mayDiscloseExternally(status: string | null): boolean {
  const d = disclosure(status);
  return d.mayUseBrand || d.mayUseClientName;
}
