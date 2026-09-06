import { after } from "next/server";
import type { NextRequest } from "next/server";
import { isInternalRequest } from "@/lib/pipeline/internal-auth";
import { processDocument } from "@/lib/pipeline/process-document";
import { maybeFinalize } from "@/lib/pipeline/finalize-project";

/**
 * 800s is the Vercel Pro maximum and REQUIRES Fluid Compute to be enabled.
 * The platform default is 300s. This is the reason processing gets its own
 * route rather than running inside the creating action's after().
 */
export const maxDuration = 800;

/**
 * `params` is explicitly typed rather than using the generated
 * RouteContext<'/api/process/[documentId]'>: that helper only exists after
 * `next typegen` has seen this file, which is a chicken-and-egg problem the
 * first time it is written and on a clean checkout.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  if (!isInternalRequest(request)) {
    return new Response(null, { status: 403 });
  }

  const { documentId } = await params;
  const { projectId, ok } = await processDocument(documentId);

  // Finalization is attempted AFTER the response, so the status='done' write is
  // committed first — otherwise the last worker counts itself as pending and
  // nobody finalizes. Runs on the failure path too: a failed document is no
  // longer pending either.
  if (projectId) {
    after(async () => {
      try {
        await maybeFinalize(projectId);
      } catch (error) {
        console.error(`[process:finalize] ${projectId}:`, error);
      }
    });
  }

  return Response.json({ ok, documentId });
}
