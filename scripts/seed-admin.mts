/**
 * Creates (or re-confirms) the super admin.
 *
 * Run with:  npm run seed:admin -- <project-ref>
 *
 * Uses Node's native type stripping — no tsx, no build step. That is also why
 * this file uses NO `@/` path aliases and imports nothing from src/: plain Node
 * does not resolve tsconfig paths.
 *
 * IDEMPOTENT. Running it twice must be a no-op the second time; the final
 * assertion is PRD §14 T2's acceptance criterion, executed by the script.
 */
import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const secretKey = required("SUPABASE_SECRET_KEY");

/*
 * TARGET CONFIRMATION.
 *
 * There is exactly one Supabase project now, and it is production. This script
 * mints a super admin — the one privilege 0007_privilege_lockdown.sql makes
 * unreachable through the API — and its upsert force-resets is_active,
 * deleted_at and is_super_admin on whatever profile carries SUPER_ADMIN_EMAIL.
 * It must not be runnable from muscle memory or a stray `npm run`.
 *
 * argv rather than an interactive prompt, so CI and a human behave identically.
 *
 * That force-reset is deliberately NOT gated behind a flag: it is the system's
 * only break-glass path. 0007 makes is_super_admin unwritable through the API,
 * and getCurrentUser() signs out a super admin who deactivates themselves — if
 * that happens, this script is the only way back in.
 */
const targetRef = new URL(url).hostname.split(".")[0];
const claimedRef = process.argv[2];

if (claimedRef !== targetRef) {
  console.error(
    `✗ Refusing to run without an explicit target.\n` +
      `  Target : ${url}\n` +
      `  Run    : npm run seed:admin -- ${targetRef}`,
  );
  process.exit(1);
}
console.log(`→ Target: ${url}`);
const email = required("SUPER_ADMIN_EMAIL").trim().toLowerCase();
const name = process.env.SUPER_ADMIN_NAME?.trim() || null;

const admin = createClient(url, secretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/**
 * Finds the auth user by listing and matching, rather than calling createUser
 * and parsing a duplicate error — the error shape is not a stable contract.
 */
async function findAuthUserId(): Promise<string | null> {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function main() {
  console.log(`→ Seeding super admin: ${email}`);

  let userId = await findAuthUserId();

  if (userId) {
    console.log("  auth user already exists");
  } else {
    // email_confirm skips the confirmation mail: PRD §12 says no invite is
    // sent, the admin notifies out of band.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
    }
    userId = data.user.id;
    console.log("  auth user created");
  }

  // The profiles_default_claims trigger deliberately skips super admins, and
  // has_claim() short-circuits on is_super_admin — so NO user_claims rows are
  // written here, and that is correct.
  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: userId,
      email,
      name,
      is_active: true,
      is_super_admin: true,
      deleted_at: null,
    },
    { onConflict: "id" },
  );
  if (profileError) throw new Error(`profile upsert failed: ${profileError.message}`);
  console.log("  profile upserted");

  // PRD §14 T2 acceptance criterion.
  const { data: hasClaim, error: claimError } = await admin.rpc("has_claim", {
    uid: userId,
    c: "projects:view",
  });
  if (claimError) throw new Error(`has_claim failed: ${claimError.message}`);

  if (hasClaim !== true) {
    console.error(`✗ has_claim('${userId}', 'projects:view') returned ${hasClaim}, expected true`);
    process.exit(1);
  }

  console.log(`✓ has_claim('${userId}', 'projects:view') === true`);
  console.log(`✓ Super admin ready. Sign in at /login with ${email}`);
}

main().catch((error) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
