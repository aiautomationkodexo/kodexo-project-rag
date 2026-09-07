/**
 * Generates supabase/setup.sql — the single-file bootstrap for a brand-new
 * Supabase project.
 *
 * Run with:  npm run build:sql
 *
 * GENERATED, not hand-written, and that is the point: the file is the literal
 * concatenation of supabase/migrations/*.sql followed by supabase/seed/*.sql,
 * so it cannot drift from what `supabase db push` applies. Editing setup.sql
 * directly is always wrong — edit the migration and regenerate.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const SEED = "supabase/seed";
const OUT = "supabase/setup.sql";

function sqlFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

const migrations = sqlFiles(MIGRATIONS);
const seeds = sqlFiles(SEED);

// Refuse to write a truncated file. Concatenating whatever happens to be on
// disk means an empty or partial migrations directory silently produces a
// setup.sql that LOOKS fine and creates almost nothing — the worst possible
// failure for a file whose entire job is standing up a project from scratch.
if (migrations.length === 0) {
  console.error(`✗ No .sql files in ${MIGRATIONS}/ — refusing to write ${OUT}.`);
  process.exit(1);
}
if (seeds.length === 0) {
  console.error(`✗ No .sql files in ${SEED}/ — refusing to write ${OUT}.`);
  process.exit(1);
}

const banner = `-- ═══════════════════════════════════════════════════════════════════════════
-- portfolio-knowledge-rag — COMPLETE SUPABASE SETUP
--
-- ⚠ GENERATED FILE — DO NOT EDIT.
--   Source: supabase/migrations/*.sql then supabase/seed/*.sql
--   Regenerate with: npm run build:sql
--   Editing this file directly means the next regeneration silently discards
--   your change. Edit the migration instead.
--
-- WHAT THIS IS FOR
--   Standing up a brand-new Supabase project in one paste, including when
--   moving to a different Supabase account. Everything the app needs:
--   schema, RLS, taxonomy, storage, realtime, RPCs, the privilege lockdown,
--   and the super admin.
--
-- HOW TO RUN
--   Dashboard → SQL Editor → paste → Run. It runs as \`postgres\`, which is
--   the privilege level the storage and publication statements want.
--   (\`npm run db:push\` remains the normal path for an already-linked project;
--   this file is the portable one.)
--
-- FOR A FRESH, EMPTY PROJECT. This is NOT idempotent as a whole: 0001 uses
-- \`create table\`, so running it against a database that already has the schema
-- stops at the first table with "relation already exists" and changes nothing.
-- That is a safety feature, not a limitation — it refuses to half-modify an
-- existing install rather than quietly diverging from it. (Verified: a re-run
-- errors immediately and leaves every row count untouched.)
--
-- To re-assert ONLY the super admin on an existing project — or to point it at
-- a different person — run supabase/seed/0100_super_admin.sql on its own. That
-- file IS idempotent, and the two values to change are at the top of it.
--
-- AFTER RUNNING, verify with \`npm run verify:cloud\`. Migration 0004 fails
-- SOFT by design — it downgrades a privilege error to a warning so that a
-- storage hiccup cannot strand 0005-0007 (an unapplied 0007 leaves a
-- privilege-escalation hole open). So a clean run is NOT proof; check.
--
-- STILL NOT DONE BY THIS FILE (see SETUP.md):
--   • Auth settings, SMTP and the magic-link template — \`npm run config:push\`
--   • Storage → Settings global file size limit (caps the bucket's 50 MB)
--   • Asymmetric JWT signing keys
--
-- Sections: ${[...migrations, ...seeds].join(", ")}
-- ═══════════════════════════════════════════════════════════════════════════

`;

const parts = [
  ...migrations.map((f) => ({ dir: MIGRATIONS, f })),
  ...seeds.map((f) => ({ dir: SEED, f })),
].map(({ dir, f }) => {
  const body = readFileSync(join(dir, f), "utf8").trimEnd();
  return (
    `\n-- ${"═".repeat(73)}\n` +
    `-- ▶ ${dir}/${f}\n` +
    `-- ${"═".repeat(73)}\n\n` +
    `${body}\n`
  );
});

writeFileSync(OUT, banner + parts.join("\n"), "utf8");

const lines = (banner + parts.join("\n")).split("\n").length;
console.log(`✓ ${OUT} — ${migrations.length} migrations + ${seeds.length} seed file(s), ${lines} lines`);
