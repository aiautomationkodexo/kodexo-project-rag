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
  doc_role: string | null;
  status: DocumentStatus;
  error: string | null;
  is_synthetic: boolean;
};

export type Tone = "neutral" | "invert" | "ok" | "warn" | "err" | "info";
