/**
 * Post-push smoke test for the linked Supabase project.
 *
 * Run with:  npm run verify:cloud
 *            npm run verify:cloud -- --send-mail
 *
 * Uses the secret key over PostgREST/Storage rather than a direct Postgres
 * connection, so it needs no database password — the same credentials the app
 * itself runs on. That also means it tests BEHAVIOUR (can the app do this?)
 * rather than catalog rows, which is the thing that actually matters.
 *
 * Native type stripping, so no `@/` aliases and no imports from src/.
 */
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY not set");
  process.exit(1);
}

const admin = createClient(url, secretKey, { auth: { persistSession: false } });

let failed = 0;
let warned = 0;

function pass(what: string, detail = "") {
  console.log(`  ✓ ${what}${detail ? ` — ${detail}` : ""}`);
}
function fail(what: string, detail: string) {
  console.log(`  ✗ ${what} — ${detail}`);
  failed++;
}
function warn(what: string, detail: string) {
  console.log(`  ! ${what} — ${detail}`);
  warned++;
}

console.log(`\n→ Target: ${url}\n`);

// ── 1. Schema: every table from 0001 is reachable ──────────────────────────
console.log("Schema (0001-0003)");
const TABLES = [
  "profiles", "user_claims", "industries", "tech_tags", "tech_tag_aliases",
  "projects", "project_tech_tags", "project_summaries", "documents",
  "chunks", "audit_log",
];
// NOTE: do NOT use { head: true } here. It issues a HEAD request, and a HEAD
// 404 has no body for supabase-js to parse — so a missing table comes back with
// error === null and reads as a PASS. Use a real GET.
const missing: string[] = [];
for (const table of TABLES) {
  const { error } = await admin.from(table).select("*").limit(1);
  if (error) missing.push(`${table} (${error.code ?? "?"})`);
}
if (missing.length === 0) pass(`all ${TABLES.length} tables reachable`);
else fail(`${missing.length}/${TABLES.length} tables unreachable`, missing.join(", "));

// Taxonomy seed actually landed (0003).
const { count: industries } = await admin
  .from("industries").select("*", { count: "exact" }).limit(1);
const { count: tags } = await admin
  .from("tech_tags").select("*", { count: "exact" }).limit(1);
if ((industries ?? 0) >= 20) pass("industries seeded", `${industries}`);
else fail("industries seeded", `expected >= 20, got ${industries}`);
if ((tags ?? 0) >= 70) pass("tech_tags seeded", `${tags}`);
else fail("tech_tags seeded", `expected ~80, got ${tags}`);

// ── 2. RPCs from 0005 / 0006 ───────────────────────────────────────────────
console.log("\nRPCs (0005, 0006)");
const { data: sa } = await admin
  .from("profiles").select("id, email").eq("is_super_admin", true)
  .is("deleted_at", null).limit(1).maybeSingle();

if (!sa) {
  warn("super admin", "none found — run `npm run seed:admin -- <ref>` first");
} else {
  const { data: claim, error: claimErr } = await admin
    .rpc("has_claim", { uid: sa.id, c: "projects:view" });
  if (claimErr) fail("has_claim()", claimErr.message);
  else if (claim === true) pass("has_claim() === true for super admin", sa.email);
  else fail("has_claim()", `returned ${claim}, expected true (PRD §14 T2)`);
}

// search_projects: signature must accept extensions.vector. A zero vector is a
// valid probe — we only care that it resolves and runs, not what it ranks.
const { error: searchErr } = await admin.rpc("search_projects", {
  query_embedding: JSON.stringify(new Array(1536).fill(0)),
  query_text: "smoke test",
  match_limit: 1,
});
if (searchErr) {
  // A permission error here is EXPECTED and correct: the RPC guards on
  // has_claim(auth.uid(), …) and the service role has no auth.uid().
  if (/Missing permission/i.test(searchErr.message)) {
    pass("search_projects() resolves", "guard fired as designed");
  } else {
    fail("search_projects()", searchErr.message);
  }
} else {
  pass("search_projects() resolves");
}

for (const fn of ["claim_finalize", "claim_document", "soft_delete_project"]) {
  const { error } = await admin.rpc(fn, fn === "claim_finalize"
    ? { p_project: "00000000-0000-0000-0000-000000000000" }
    : fn === "claim_document"
      ? { p_document: "00000000-0000-0000-0000-000000000000" }
      : { p_project: "00000000-0000-0000-0000-000000000000" });
  // Any response that isn't "function not found" means it exists.
  if (error && /Could not find the function|does not exist/i.test(error.message)) {
    fail(`${fn}()`, "not found — migration missing");
  } else {
    pass(`${fn}() exists`);
  }
}

// ── 2b. RPCs from 0009 / 0011 ──────────────────────────────────────────────
console.log("\nSweep + tag admin (0009, 0011)");

// Read-only and safe to call for real: each returns rows rather than mutating.
// Calling them proves the migration landed AND that the function actually runs,
// which a catalog lookup does not.
const readOnlyRpcs: [string, Record<string, unknown>][] = [
  ["stranded_projects", { older_than_minutes: 15 }],
  ["purgeable_projects", { older_than_days: 30, match_limit: 1 }],
  ["recently_active_projects", { within_hours: 24, match_limit: 1 }],
];

for (const [fn, args] of readOnlyRpcs) {
  const { error } = await admin.rpc(fn, args);
  if (error && /Could not find the function|does not exist/i.test(error.message)) {
    fail(`${fn}()`, "not found — migration 0009 missing");
  } else if (error) {
    fail(`${fn}()`, error.message);
  } else {
    pass(`${fn}() runs`);
  }
}

// The claim-guarded pair. Under the service role auth.uid() is null, so
// has_claim() is false and both raise before touching a row — which makes this
// a SAFE existence probe for a function that would otherwise mutate.
for (const [fn, args] of [
  ["unapproved_tag_usage", {}],
  ["merge_tech_tag", {
    p_source: "00000000-0000-0000-0000-000000000000",
    p_target: "00000000-0000-0000-0000-000000000001",
  }],
] as [string, Record<string, unknown>][]) {
  const { error } = await admin.rpc(fn, args);
  if (error && /Could not find the function|does not exist/i.test(error.message)) {
    fail(`${fn}()`, "not found — migration 0011 missing");
  } else if (error && /Missing permission: tags:manage/.test(error.message)) {
    pass(`${fn}() resolves`, "claim guard fired as designed");
  } else if (error) {
    fail(`${fn}()`, error.message);
  } else {
    // merge_tech_tag reaching here would mean the guard did NOT fire.
    warn(`${fn}()`, "returned without the expected tags:manage guard");
  }
}

// A real functional check, not an existence probe: this is THE definition of
// the alias rule, and src/lib/tags/alias-key.ts is a copy of it. If these ever
// disagree, finalize writes aliases that can never resolve and duplicate tags
// start accumulating with nothing raised anywhere.
const { data: aliasKey, error: aliasErr } = await admin.rpc("tech_tag_alias_key", {
  name: "Next.js",
});
if (aliasErr && /Could not find the function|does not exist/i.test(aliasErr.message)) {
  fail("tech_tag_alias_key()", "not found — migration 0011 missing");
} else if (aliasErr) {
  fail("tech_tag_alias_key()", aliasErr.message);
} else if (aliasKey !== "nextjs") {
  fail("tech_tag_alias_key('Next.js')", `returned ${JSON.stringify(aliasKey)}, expected "nextjs" — SQL has drifted from src/lib/tags/alias-key.ts`);
} else {
  pass("tech_tag_alias_key() matches the TS copy", "'Next.js' → 'nextjs'");
}

// ── 3. Storage bucket (0004a) ──────────────────────────────────────────────
console.log("\nStorage (0004)");
const { data: buckets, error: bucketErr } = await admin.storage.listBuckets();
if (bucketErr) {
  fail("listBuckets()", bucketErr.message);
} else {
  const b = buckets?.find((x) => x.id === "project-files");
  if (!b) {
    fail("bucket project-files", "MISSING — run `npm run buckets:push`");
  } else {
    pass("bucket project-files exists");
    if (b.public) fail("bucket visibility", "PUBLIC — must be private");
    else pass("bucket is private");
    const limit = (b as { file_size_limit?: number | null }).file_size_limit;
    if (limit === 209715200) pass("file_size_limit", "200 MB");
    else warn("file_size_limit", `${limit ?? "unset"} — expected 209715200; check Storage → Settings for the GLOBAL cap too (it defaults below 200 MB and silently clamps the bucket)`);
  }
}

// ── 4. Realtime publication (0004c) — absence is NOT tolerable ─────────────
console.log("\nRealtime (0004)");
await (async () => {
  // Subscribing alone proves NOTHING: Realtime accepts a channel for a table
  // that is not in the publication (it is just a filter over the WAL stream).
  // The only honest check is to round-trip a real UPDATE and see it arrive.
  //
  // Deliberately uses the SECRET key. postgres_changes applies RLS per
  // subscriber, so the publishable key with no session correctly receives
  // nothing (no auth.uid() => no projects:view) — that would look like a
  // publication failure but is RLS working. The app's own subscriber in
  // live-status.tsx is an authenticated user, which is verified separately.
  const { data: probe, error: insErr } = await admin
    .from("projects")
    .insert({ title: "realtime probe", status: "processing" })
    .select("id")
    .maybeSingle();

  if (insErr || !probe) {
    warn("realtime", `could not insert a probe row (${insErr?.message ?? "no row"}) — skipped`);
    return;
  }

  const rt = createClient(url, secretKey, { auth: { persistSession: false } });
  try {
    const got = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15_000);
      const channel = rt
        .channel(`verify-${probe.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${probe.id}` },
          () => { clearTimeout(timer); resolve(true); },
        )
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            // SUBSCRIBED fires before the postgres_changes binding is actually
            // live server-side. Updating immediately raced it on a hosted
            // project (loopback latency hid this locally) and produced a FALSE
            // "not in the publication" failure on a project that was fine.
            await new Promise((r) => setTimeout(r, 1500));
            await admin.from("projects").update({ status: "ready" }).eq("id", probe.id);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timer);
            resolve(false);
          }
        });
      void channel;
    });

    if (got) pass("UPDATE on public.projects round-tripped through Realtime");
    else fail("realtime", "no event received — public.projects is not in the supabase_realtime publication. The /projects/[id] status panel will never update");
  } finally {
    await rt.removeAllChannels();
    await admin.from("projects").delete().eq("id", probe.id);
  }
})();

// ── 5. SMTP ────────────────────────────────────────────────────────────────
console.log("\nMail");
const smtpHost = process.env.SMTP_HOST;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASSWORD?.replace(/\s+/g, "");
const emailFrom = process.env.EMAIL_FROM;

if (!smtpHost || !smtpUser || !smtpPass || !emailFrom) {
  warn("SMTP", "not fully configured — the completion email would no-op (valid state)");
} else {
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
  try {
    await transport.verify();
    pass("SMTP credentials accepted", `${smtpHost}:${process.env.SMTP_PORT ?? 587}`);

    if (process.argv.includes("--send-mail")) {
      const to = process.env.SUPER_ADMIN_EMAIL ?? emailFrom;
      const info = await transport.sendMail({
        from: emailFrom,
        to,
        subject: "Portfolio KB — SMTP smoke test",
        text: "If you are reading this, the completion email path works.",
        html: "<p>If you are reading this, the completion email path works.</p>",
      });
      pass("test email sent", `to ${to} (${info.messageId})`);
    } else {
      console.log("    (pass --send-mail to actually deliver one)");
    }
  } catch (error) {
    fail("SMTP", error instanceof Error ? error.message : String(error));
  } finally {
    transport.close();
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(
  `\n${failed === 0 ? "✓" : "✗"} ${failed} failed, ${warned} warning(s)\n`,
);
console.log(
  "Not checkable from here (use the dashboard SQL editor, SETUP.md §2):\n" +
    "  • RLS enabled per table, and 0007's profiles column grants\n" +
    "  • storage.objects policies (dead code today — service-role bypasses RLS)\n",
);
process.exit(failed === 0 ? 0 : 1);
