/**
 * Status unions.
 *
 * Defined here rather than imported from database.types: these are CHECK
 * constraints in 0001_schema.sql, not Postgres enums, so the type generator
 * emits plain `string` and the narrowing would be lost. Keep these in sync with
 * the CHECK clauses — StatusChip depends on their exhaustiveness.
 */
export type ProjectStatus = "processing" | "finalizing" | "ready";
export type DocumentStatus = "queued" | "processing" | "done" | "failed";

const PROJECT_STATUSES: readonly string[] = ["processing", "finalizing", "ready"];
const DOCUMENT_STATUSES: readonly string[] = ["queued", "processing", "done", "failed"];

/**
 * Narrows the `string` the type generator emits for a CHECK-constrained column.
 * The database guarantees the value; these fall back rather than throw so a
 * future status added in SQL degrades instead of crashing the page.
 */
export function asProjectStatus(value: string): ProjectStatus {
  return PROJECT_STATUSES.includes(value) ? (value as ProjectStatus) : "processing";
}

export function asDocumentStatus(value: string): DocumentStatus {
  return DOCUMENT_STATUSES.includes(value) ? (value as DocumentStatus) : "queued";
}

/**
 * A summary section (PRD §11).
 *
 * Stored as an ORDERED ARRAY, never an object, so display order is explicit
 * and sections can be appended or reordered without key collisions.
 *
 * The section set is MODEL-GENERATED and grows over time — `client_feedback`,
 * `awards`, `press_coverage`, `migration_notes`, anything the material
 * warrants. §15.12: never hardcode these names anywhere in the UI.
 */
export type SummarySection = {
  /** Stable lowercase_snake_case slug. The model must reuse these exactly. */
  key: string;
  /** Display heading. */
  label: string;
  /** Plain prose. No markdown. */
  content: string;
};

export type Summary = { sections: SummarySection[] };

/** Narrows the untyped jsonb column without trusting its contents. */
export function asSummary(value: unknown): Summary | null {
  if (!value || typeof value !== "object") return null;
  const sections = (value as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return null;
  return {
    sections: sections.filter(
      (s): s is SummarySection =>
        !!s &&
        typeof s === "object" &&
        typeof (s as SummarySection).key === "string" &&
        typeof (s as SummarySection).content === "string",
    ),
  };
}

/**
 * A stored case study outline section (migration 0018).
 *
 * `label` IS DENORMALISED INTO THE STORED JSON, deliberately — it is not read
 * back from CASE_STUDY_SECTIONS at render time. A generated document is a
 * record of what was produced, and if the house section list is later renamed
 * or reordered, an outline generated last quarter must still render with the
 * headings it was actually written against. Reading labels live would silently
 * relabel existing documents.
 *
 * Contrast SummarySection, whose keys are model-generated and open-ended
 * (§15.11): these keys come from OUR fixed list, so the stored copy is a
 * snapshot rather than the authority.
 */
export type CaseStudyOutlineSection = {
  key: string;
  label: string;
  /** Prose. Empty string is legal and means "the corpus supported nothing". */
  content: string;
};

export type StoredCaseStudyOutline = {
  /** One-line positioning, or null when the corpus did not support one. */
  headline: string | null;
  sections: CaseStudyOutlineSection[];
};

/**
 * Narrows the untyped jsonb column without trusting its contents, exactly as
 * asSummary does. Anything malformed is dropped rather than thrown on: a bad
 * row must degrade to "no outline", never break the project page.
 */
export function asCaseStudyOutline(
  value: unknown,
): StoredCaseStudyOutline | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { headline?: unknown; sections?: unknown };
  if (!Array.isArray(raw.sections)) return null;

  const sections = raw.sections.flatMap((s): CaseStudyOutlineSection[] => {
    if (!s || typeof s !== "object") return [];
    const row = s as Record<string, unknown>;
    if (typeof row.key !== "string" || typeof row.label !== "string") return [];
    return [
      {
        key: row.key,
        label: row.label,
        content: typeof row.content === "string" ? row.content : "",
      },
    ];
  });

  if (sections.length === 0) return null;

  return {
    headline: typeof raw.headline === "string" ? raw.headline : null,
    sections,
  };
}

/** The row as the project page needs it. */
export type CaseStudyRow = {
  outline: StoredCaseStudyOutline;
  /** Null means no downloadable object — render the outline regardless. */
  storage_key: string | null;
  filename: string;
  size_bytes: number | null;
  generated_at: string;
};

export type TechTag = {
  id: string;
  canonical_name: string;
  is_approved: boolean;
};

/** Never carries raw_text, embedding or summary_embedding (§15.10). */
export type ProjectListItem = {
  id: string;
  title: string;
  status: ProjectStatus;
  industry: string | null;
  summary_text: string | null;
  created_at: string;
  tags: TechTag[];
};

export type SearchHit = {
  project_id: string;
  score: number;
  best_snippet: string;
  best_source: string;
};

export type ProjectSearchResult = ProjectListItem & {
  snippet: string;
  source: string;
};

export type DocumentRow = {
  id: string;
  filename: string;
  /** Needed to tell a transcription in progress from a parse (T7). */
  mime: string;
  doc_role: string | null;
  status: DocumentStatus;
  error: string | null;
  is_synthetic: boolean;
  /** 'indexed' | 'no_index'. See migration 0016 and DocumentVisibility. */
  visibility: string;
};

/**
 * Document visibility (migration 0016). Same reasoning as the status unions
 * above: a CHECK constraint, so the type generator emits plain `string`.
 */
export type DocumentVisibility = "indexed" | "no_index";

const DOCUMENT_VISIBILITIES: readonly string[] = ["indexed", "no_index"];

export function asDocumentVisibility(value: string): DocumentVisibility {
  return DOCUMENT_VISIBILITIES.includes(value)
    ? (value as DocumentVisibility)
    : "indexed";
}

export type Tone = "neutral" | "invert" | "ok" | "warn" | "err" | "info";

/**
 * Features delivered (migration 0017).
 *
 * ARRAY ORDER IS DISPLAY ORDER — getProject sorts by `ordinal`. A .sort() in
 * any consumer is a bug, for the same reason it is one in summary-sections:
 * the order is the model's judgement of significance and is recoverable from
 * nothing else.
 *
 * No narrowing helper, unlike ProjectStatus / DocumentVisibility above: these
 * columns are not CHECK-constrained vocabularies, they are free text and an
 * int. An asFeatureRow() would be ceremony that validates nothing.
 */
export type FeatureRow = {
  id: string;
  name: string;
  description: string;
  ordinal: number;
};

/**
 * Proof points (migration 0017).
 *
 * `metric` is null for a genuinely qualitative outcome — prompt rule 5 says
 * null rather than invent a number, so null is the correct value and not
 * missing data.
 *
 * `source_label` is pre-resolved in getProject from a LEFT join, and is
 * legitimately null: source_document_id is ON DELETE SET NULL, and a
 * model-reported filename can match nothing. Render NO attribution in that
 * case — never a fallback that implies a source.
 *
 * ⚠ `evidence_quote` is VERBATIM corpus text. The extraction prompt asks the
 *   model never to name a client, but that is a mitigation, not a control:
 *   raw_text contains those names and nothing detects a leak. No UI copy may
 *   describe these as anonymised. See migration 0017's header.
 */
export type ProofPointRow = {
  id: string;
  claim: string;
  metric: string | null;
  evidence_quote: string;
  ordinal: number;
  source_label: string | null;
};
