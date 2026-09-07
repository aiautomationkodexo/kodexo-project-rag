import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Audit trail (PRD §4 audit_log, §14 T8).
 *
 * ── Why the ADMIN client ───────────────────────────────────────────────────
 * There is deliberately no INSERT policy on audit_log — 0002_rls.sql states it:
 * "Read-only even to super admins. Writes go through the service role." An
 * append-only log that its own subjects can write is not a log. `actorId` is
 * passed explicitly by the caller, which has already authenticated the actor
 * via getCurrentUser().
 *
 * (merge_tech_tag in 0011 writes its own row in SQL instead, which is strictly
 * better — that one is atomic with the mutation it records. It is only possible
 * there because the work already happens inside a definer function.)
 *
 * ── Why this NEVER throws ──────────────────────────────────────────────────
 * Every call site runs AFTER its mutation has committed. Throwing would report
 * failure for work that actually succeeded — and in deleteProject and
 * softDeleteUser, which throw to an error boundary, the user would be told a
 * deletion failed while the row is already gone. A missing audit row is a
 * smaller, louder-in-the-logs problem than a lie about what happened.
 *
 * Deliberately NOT wrapped in after(): a serverless invocation can freeze the
 * moment its handler returns, and a detached promise is simply lost. Awaiting a
 * single insert is cheap.
 */
export type AuditEntry = {
  /** The authenticated actor. Null only for system-initiated writes. */
  actorId: string | null;
  /** Dotted `entity.verb`, e.g. "project.delete". Kept greppable. */
  action: string;
  entityType: string;
  entityId: string | null;
  meta?: Record<string, Json>;
};

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_log").insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      meta: (entry.meta ?? null) as Json,
    });

    if (error) {
      console.error(`[audit] ${entry.action} ${entry.entityId}:`, error.message);
    }
  } catch (error) {
    console.error(`[audit] ${entry.action} ${entry.entityId}:`, error);
  }
}
