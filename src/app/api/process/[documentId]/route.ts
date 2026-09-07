import { after } from "next/server";
import type { NextRequest } from "next/server";
import { isInternalRequest } from "@/lib/pipeline/internal-auth";
import { processDocument } from "@/lib/pipeline/process-document";
import { maybeFinalize } from "@/lib/pipeline/finalize-project";

/**
 * 800s is the Vercel Pro maximum and REQUIRES Fluid Compute to be enabled.
 * The platform default is 300s. This is the reason processing gets its own
 * route rather than running inside the creating action's after().
 *
 * TIMING INVARIANT — do not raise this past 900 without changing the other two:
 *
 *   TRANSCRIBE_TIMEOUT_MS (600s)  <  maxDuration (800s)  <  reclaim (900s)
 *
 * claim_document (0005_rpc.sql) reclaims a document stuck in 'processing' after
 * 15 minutes. maxDuration < that window is what guarantees the first invocation
 * is already dead before the row becomes claimable, i.e. that there is never a
 * second worker. Invert it and two workers transcribe the same document and
 * then race delete-then-insert on its chunks — which
 * chunks_document_ordinal_idx (0009) now turns into a loud 23505 rather than a
 * silently duplicated chunk set, but the right fix is to keep the ordering.
 *
 * Before T7 nothing came within an order of magnitude of 800s and this was
 * incidental. A 600s transcription makes it load-bearing.
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
