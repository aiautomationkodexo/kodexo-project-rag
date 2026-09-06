import "server-only";

import { serverEnv } from "@/lib/env";
import { processDocument } from "./process-document";
import { maybeFinalize } from "./finalize-project";

/** OpenAI rate limits, not a Vercel constraint. */
const CONCURRENCY = 4;

/**
 * Kicks off processing for a set of documents.
 *
 * TWO TRANSPORTS, ONE CORE. Both call the identical processDocument /
 * maybeFinalize functions, so they cannot diverge in behaviour.
 *
 * 'http' (production): one function invocation per document. This matters
 *   because `after()` runs within the MAX DURATION OF ITS OWN ROUTE — an
 *   after() registered in a page's Server Action inherits the page's budget,
 *   not the 800s the processing route declares. Fanning out also isolates
 *   memory (2GB per invocation) and failures, and gives the T6 cron sweep a
 *   single retry entry point.
 *
 * 'inline' (dev/tests): runs in-process. Lets the pipeline be exercised from a
 *   script with no server running.
 */
export async function dispatch(
  documentIds: string[],
  projectId: string,
): Promise<void> {
  if (documentIds.length === 0) return;

  if (serverEnv.pipelineMode === "inline") {
    for (const id of documentIds) {
      try {
        await processDocument(id);
      } catch (error) {
        console.error(`[dispatch:inline] ${id}:`, error);
      }
    }
    // Called unconditionally, including after failures: a failed document is no
    // longer pending, so finalize must still get its chance.
    await maybeFinalize(projectId);
    return;
  }

  const queue = [...documentIds];
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        const id = queue.shift();
        if (!id) break;
        try {
          await fetch(`${serverEnv.internalBaseUrl}/api/process/${id}`, {
            method: "POST",
            headers: { "x-internal": serverEnv.internalSecret },
          });
        } catch (error) {
          // Swallowed on purpose: the cron sweep re-POSTs stuck documents, so a
          // transport failure here is recoverable rather than fatal.
          console.error(`[dispatch:http] ${id}:`, error);
        }
      }
    },
  );

  await Promise.all(workers);
}
