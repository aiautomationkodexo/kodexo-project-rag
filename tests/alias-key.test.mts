import { test } from "node:test";
import assert from "node:assert/strict";
import { aliasKey } from "@/lib/tags/alias-key";

/**
 * The TS half of a rule whose authority is `tech_tag_alias_key(text)` in SQL
 * (migration 0011). These expectations are transcribed from PRD §7 and from
 * 0003's own comment, so a drift in either copy fails here rather than showing
 * up as a duplicate tag in the review queue weeks later.
 */
test("aliasKey matches the SQL normalisation rule", () => {
  const cases: [string, string][] = [
    // The three the migration comments call out by name.
    ["Next.js", "nextjs"],
    ["C#", "c"],
    [".NET", "net"],
    // Ordinary shapes.
    ["JavaScript", "javascript"],
    ["Node.js", "nodejs"],
    ["Tailwind CSS", "tailwindcss"],
    ["Ruby on Rails", "rubyonrails"],
    ["Google Cloud", "googlecloud"],
    ["PostgreSQL", "postgresql"],
    // Already normalised input is a fixed point — the property the CHECK
    // constraint `alias = tech_tag_alias_key(alias)` actually asserts.
    ["nextjs", "nextjs"],
    ["gpt4", "gpt4"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(aliasKey(input), expected, `aliasKey(${JSON.stringify(input)})`);
  }
});

test("aliasKey is idempotent", () => {
  // The CHECK constraint added in 0011 is exactly this property. If it ever
  // fails, every alias insert starts throwing 23514.
  for (const name of ["Next.js", "C#", ".NET", "Vertex AI", "  spaced  ", "unicode"]) {
    assert.equal(aliasKey(aliasKey(name)), aliasKey(name), name);
  }
});

test("aliasKey collapses symbol-only names to the empty string", () => {
  // Not a bug, but the reason 0011's trigger and merge_tech_tag both skip the
  // alias insert when the key is empty: every symbol-only name keys the same,
  // so writing one would make unrelated tags collide.
  assert.equal(aliasKey("++"), "");
  assert.equal(aliasKey("---"), "");
});
