import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export const maxDuration = 800;

/**
 * Recovers work lost to crashed invocations. Scheduled every 5 minutes in
 * vercel.json — a Pro-plan feature; Hobby is limited to daily crons and would
 * fail the deployment.
 *
 * Step 3 of PRD §13 (orphaned Storage cleanup) lands in T6, when uploads exist.
 * It is required: Supabase Storage does NOT cascade from Postgres deletes, so
 * without it deleted projects keep costing storage.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(null, { status: 403 });
  }

  const admin = createAdminClient();

  // 1. Re-dispatch stuck documents. Selects BOTH 'queued' and 'processing' —
  //    see 0005_rpc.sql for why 'processing' alone stranded projects forever.
  const { data: stuck } = await admin.rpc("stuck_documents", {
    older_than_minutes: 15,
  });

  for (const doc of stuck ?? []) {
    try {
      await fetch(`${serverEnv.internalBaseUrl}/api/process/${doc.id}`, {
        method: "POST",
        headers: { "x-internal": serverEnv.internalSecret },
      });
    } catch (error) {
      console.error(`[sweep:process] ${doc.id}:`, error);
    }
  }

  // 2. §15.9: force any project stranded in 'finalizing' back to 'ready'.
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: stranded } = await admin
    .from("projects")
    .update({ status: "ready" })
    .eq("status", "finalizing")
    .lt("updated_at", cutoff)
    .select("id");

  return Response.json({
    ok: true,
    requeued: stuck?.length ?? 0,
    unstranded: stranded?.length ?? 0,
  });
}
