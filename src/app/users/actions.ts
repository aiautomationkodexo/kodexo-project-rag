"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, assertClaim } from "@/lib/auth/claims";
import { can, type Claim } from "@/lib/auth/claim-set";
import {
  normalizeEmail,
  parseClaims,
  validateUserInput,
  type UserFieldErrors,
} from "@/lib/users/validate";
import { writeAudit } from "@/lib/audit/write";

export type UserActionState = {
  error?: string;
  fieldErrors?: UserFieldErrors;
  ok?: string;
};

/**
 * Creating a user needs BOTH clients, and which one does what is the design:
 *
 *   admin client  — the auth user and the profile row. There is deliberately
 *                   no INSERT policy on `profiles` (0002_rls.sql), so this is
 *                   the only way in.
 *   USER's client — the claim rows. This is load-bearing: the per-row
 *                   `has_claim(uid, claim)` arm of `claims_insert` IS the
 *                   acceptance criterion ("cannot grant a claim you lack").
 *                   Using the admin client here would bypass RLS and silently
 *                   void it.
 *
 * No transaction spans the auth API and the database, so a failure after the
 * auth user exists is rolled back explicitly with deleteUser().
 */
export async function createUser(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "Your session has expired. Sign in again." };

  try {
    assertClaim(actor, "users:create");
  } catch {
    return { error: "You do not have permission to create users." };
  }

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const name = String(formData.get("name") ?? "").trim();
  const requested = parseClaims(formData.getAll("claims").map(String));

  const fieldErrors = validateUserInput({ email, name });

  // Refuse client-side rather than letting RLS reject the batch, so the message
  // can name the offending claims instead of a generic 42501.
  const notHeld = requested.filter((c) => !can(actor, c));
  if (notHeld.length > 0) {
    fieldErrors.claims =
      `You cannot grant permissions you do not hold yourself: ${notHeld.join(", ")}.`;
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const admin = createAdminClient();

  // Idempotent by email, matching scripts/seed-admin.mts — createUser's
  // duplicate-error shape is not a stable contract.
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (existing?.users.some((u) => u.email?.toLowerCase() === email)) {
    return { fieldErrors: { email: "An account with that address already exists." } };
  }

  // email_confirm skips the confirmation mail. PRD §12: no invite is sent, the
  // admin notifies the person out of band.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    return { error: createError?.message ?? "Could not create the account." };
  }
  const userId = created.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    email,
    name: name || null,
    is_active: true,
    is_super_admin: false, // never settable from a form; 0007 blocks it anyway
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(userId); // roll back the orphan
    return { error: profileError.message };
  }

  // The `grant_default_claims` trigger has already inserted projects:view.
  const supabase = await createClient();
  const extra = requested.filter((c) => c !== "projects:view");
  if (extra.length > 0) {
    const { error: claimError } = await supabase
      .from("user_claims")
      .upsert(
        extra.map((claim) => ({ user_id: userId, claim })),
        { onConflict: "user_id,claim", ignoreDuplicates: true },
      );
    if (claimError) {
      await admin.auth.admin.deleteUser(userId); // profile cascades
      return { error: `Permissions could not be granted: ${claimError.message}` };
    }
  }

  await writeAudit({
    actorId: actor.id,
    action: "user.create",
    entityType: "profile",
    entityId: userId,
    meta: { email, claims: extra.length },
  });

  revalidatePath("/users");
  redirect(`/users/${userId}`);
}

/**
 * Replaces the whole claim set in one submit.
 *
 * A multi-row insert is ONE statement, so `claims_insert` evaluates its
 * per-row guard across the batch and rejects all of it if any single claim is
 * one the actor lacks. The UI disables those boxes, and the pre-check above
 * produces a readable message, but the database is the authority.
 */
export async function updateUserClaims(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "Your session has expired. Sign in again." };

  try {
    assertClaim(actor, "users:update");
  } catch {
    return { error: "You do not have permission to edit permissions." };
  }

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Missing user id." };

  /*
   * No editing your own permissions — the same separation setUserActive and
   * softDeleteUser already enforce.
   *
   * This is NOT an escalation guard; RLS already is one. claims_insert's
   * per-row `has_claim(auth.uid(), claim)` arm means you can only ever grant a
   * claim you already hold, so self-editing cannot raise your ceiling.
   *
   * What it prevents is self-DEMOTION: revoking your own 'users:update' is
   * permitted by that same policy (you hold the claim, so you may delete the
   * row) and it locks you out of the only screen that could undo it — recovery
   * then needs another holder, or the seed script. And a permission system in
   * which the subject is also the approver is wrong regardless.
   */
  if (userId === actor.id) {
    return { error: "You cannot change your own permissions." };
  }

  const selected = parseClaims(formData.getAll("claims").map(String));

  const supabase = await createClient();
  const { data: currentRows, error: readError } = await supabase
    .from("user_claims")
    .select("claim")
    .eq("user_id", userId);
  if (readError) return { error: readError.message };

  const current = new Set((currentRows ?? []).map((r) => r.claim as Claim));
  const target = new Set(selected);

  const toAdd = [...target].filter((c) => !current.has(c));
  const toRemove = [...current].filter((c) => !target.has(c));

  const unauthorized = [...toAdd, ...toRemove].filter((c) => !can(actor, c));
  if (unauthorized.length > 0) {
    return {
      fieldErrors: {
        claims: `You cannot change permissions you do not hold yourself: ${unauthorized.join(", ")}.`,
      },
    };
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("user_claims")
      .delete()
      .eq("user_id", userId)
      .in("claim", toRemove);
    if (error) return { error: error.message };
  }

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("user_claims")
      .upsert(
        toAdd.map((claim) => ({ user_id: userId, claim })),
        { onConflict: "user_id,claim", ignoreDuplicates: true },
      );
    if (error) return { error: error.message };
  }

  // The privilege-change record. Written even for a no-op submit would be
  // noise, so it is gated on something having actually changed.
  if (toAdd.length > 0 || toRemove.length > 0) {
    await writeAudit({
      actorId: actor.id,
      action: "user.claims_update",
      entityType: "profile",
      entityId: userId,
      meta: { granted: toAdd, revoked: toRemove },
    });
  }

  revalidatePath(`/users/${userId}`);
  revalidatePath("/users");

  if (toAdd.length === 0 && toRemove.length === 0) return { ok: "No changes." };
  return {
    ok: `Saved. ${toAdd.length} granted, ${toRemove.length} revoked.`,
  };
}

/** Rename. `email` is immutable (0007) — it is the sign-in identity. */
export async function updateUserProfile(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "Your session has expired. Sign in again." };

  try {
    assertClaim(actor, "users:update");
  } catch {
    return { error: "You do not have permission to edit users." };
  }

  const userId = String(formData.get("userId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!userId) return { error: "Missing user id." };

  const fieldErrors = validateUserInput({ email: "placeholder@example.com", name });
  delete fieldErrors.email;
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ name: name || null })
    .eq("id", userId);
  if (error) return { error: error.message };

  await writeAudit({
    actorId: actor.id,
    action: "user.profile_update",
    entityType: "profile",
    entityId: userId,
    meta: { name: name || null },
  });

  revalidatePath(`/users/${userId}`);
  return { ok: "Saved." };
}

/**
 * Deactivate / reactivate.
 *
 * The `guard_super_admin` trigger blocks deactivating the last active super
 * admin and raises `Cannot remove the last active super admin`, which arrives
 * here as `error.message` and renders in the existing error Callout. That is
 * the whole implementation of that acceptance criterion.
 */
export async function setUserActive(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "Your session has expired. Sign in again." };

  try {
    assertClaim(actor, "users:update");
  } catch {
    return { error: "You do not have permission to deactivate users." };
  }

  const userId = String(formData.get("userId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!userId) return { error: "Missing user id." };

  if (userId === actor.id && !active) {
    return { error: "You cannot deactivate your own account." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("id", userId);
  if (error) return { error: error.message };

  await writeAudit({
    actorId: actor.id,
    action: "user.set_active",
    entityType: "profile",
    entityId: userId,
    meta: { is_active: active },
  });

  revalidatePath(`/users/${userId}`);
  revalidatePath("/users");
  return { ok: active ? "Account reactivated." : "Account deactivated." };
}

/**
 * Soft delete. Sets deleted_at AND is_active=false in one statement.
 *
 * There is no hard delete: projects.created_by, projects.last_updated_by and
 * audit_log.actor_id all reference profiles(id) with no ON DELETE clause, so a
 * real DELETE fails for anyone who has ever touched a project — and losing the
 * attribution shown in the project record footer would be wrong anyway.
 *
 * Unlike projects this needs no RPC: `profiles_select` never references
 * deleted_at, so writing it does not make the row invisible to its own writer
 * (contrast 0006_soft_delete.sql). The cost is that RLS does not hide deleted
 * users either — src/lib/users/queries.ts filters them in the app layer.
 */
export async function softDeleteUser(formData: FormData): Promise<void> {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  assertClaim(actor, "users:delete");

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;

  if (userId === actor.id) {
    throw new Error("You cannot delete your own account.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: actor.id,
    action: "user.delete",
    entityType: "profile",
    entityId: userId,
  });

  revalidatePath("/users");
  redirect("/users");
}
