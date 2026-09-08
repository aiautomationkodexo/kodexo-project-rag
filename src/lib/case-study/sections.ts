/**
 * The case study house structure (migration 0018).
 *
 * NOT `server-only`: the project page renders these labels, so this module is
 * imported from a client boundary as well as from the pipeline. It holds no
 * secrets and reads nothing.
 *
 * ── WHY THIS IS A FIXED LIST AND THE SUMMARY'S IS NOT ─────────────────────
 * projects.summary is open-section by design (§15.11, §15.12): its shape has
 * to follow whatever the corpus contains, and prompt rule 1 exists to stop
 * regeneration re-slugging keys. A case study is the opposite kind of object —
 * a deliverable with a house style. A reader expects the same headings in the
 * same order across every project, and a writer filling in the blanks needs
 * to know which blanks exist. So the SKELETON is ours and only the CONTENT is
 * the model's.
 *
 * The consequence is that this array is the authority on both order and
 * wording. The model is given these keys and returns content against them;
 * anything it invents is dropped rather than rendered (see toOutline).
 */

export type CaseStudySection = {
  /** Stable identifier. Stored in the outline JSON; never shown to a reader. */
  readonly key: string;
  /** The heading, as it appears in the DOCX and on the project page. */
  readonly label: string;
  /**
   * What this section is for, sent to the model as its brief and shown to the
   * writer as guidance under the heading when the section is empty.
   */
  readonly brief: string;
};

export const CASE_STUDY_SECTIONS: readonly CaseStudySection[] = [
  {
    key: "client_context",
    label: "Client & Context",
    brief:
      "Who the client is (by sector and scale, not necessarily by name), " +
      "what they do, and the situation they were operating in.",
  },
  {
    key: "problem",
    label: "The Problem",
    brief:
      "The concrete operational problem, stated in the client's terms. What " +
      "was costing them time, money or accuracy before this work.",
  },
  {
    key: "approach",
    label: "Our Approach",
    brief:
      "How the work was framed and sequenced — discovery, phasing, key " +
      "decisions and trade-offs. Not a feature list.",
  },
  {
    key: "solution",
    label: "What We Built",
    brief:
      "The delivered system, described by what a user can now do. Name the " +
      "significant technical choices where they mattered to the outcome.",
  },
  {
    key: "results",
    label: "Results",
    brief:
      "Quantified outcomes with their figures. Only what the material " +
      "actually evidences.",
  },
  {
    key: "testimonial",
    label: "In Their Words",
    brief:
      "Direct quotes from the client, verbatim, attributed as the material " +
      "permits.",
  },
  {
    key: "takeaway",
    label: "Why It Matters",
    brief:
      "The transferable point — what this project demonstrates that a " +
      "prospective client in a similar position would care about.",
  },
] as const;

/** Lookup by key, for resolving the model's returned sections. */
export const SECTION_BY_KEY = new Map(
  CASE_STUDY_SECTIONS.map((s) => [s.key, s]),
);
