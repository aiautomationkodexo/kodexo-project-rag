/**
 * PRD §7 alias normalisation: lower(name) with non-alphanumerics stripped.
 * 'Next.js' keys as 'nextjs', 'C#' as 'c', '.NET' as 'net'.
 *
 * NOT `server-only`: this is a pure string function with no I/O, and keeping it
 * importable is what lets it be tested directly.
 *
 * ── THIS IS A COPY. The definition is `tech_tag_alias_key(text)` in SQL. ────
 *
 * The rule has lived in two places since 0003 (SQL derived every seeded
 * self-alias; TS computes the key for resolveTags' batched lookup), and the
 * copies were kept in step by a comment and nothing else. A drift here does not
 * throw — it writes an alias that simply never matches, so the symptom is a
 * duplicate tag appearing in the review queue weeks later.
 *
 * Migration 0011 makes that loud: `tech_tag_aliases` now CHECKs
 * `alias = tech_tag_alias_key(alias)`, so a drifted key fails with 23505/23514
 * on the very next finalize that creates a tag. Do not change this expression
 * without changing the SQL function in the same commit.
 */
export function aliasKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
