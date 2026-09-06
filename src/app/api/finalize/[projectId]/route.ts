import type { NextRequest } from "next/server";
import { isInternalRequest } from "@/lib/pipeline/internal-auth";
import { maybeFinalize } from "@/lib/pipeline/finalize-project";

export const maxDuration = 800;

/**
 * Direct finalization entry point, used by the cron sweep.
 *
 * Still goes through maybeFinalize → claim_finalize, so §15.6 holds: this route
 * cannot finalize a project that still has pending documents, and it cannot
 * race a worker that is already finalizing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  if (!isInternalRequest(request)) {
    return new Response(null, { status: 403 });
  }

  const { projectId } = await params;
  const finalized = await maybeFinalize(projectId);

  return Response.json({ ok: true, finalized });
}
