"use client";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

/**
 * The root error boundary.
 *
 * `error.message` is rendered as-is. In production React replaces a server
 * error's message with a generic string and supplies `digest` instead, so
 * nothing internal leaks; in development the real message is what makes the
 * page useful. The digest is shown in mono because its only purpose is to be
 * copied into a log search.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-n50 px-shell py-section">
      <div className="elev-md w-full max-w-form rounded-md border border-n200 bg-white px-section py-section">
        <h1 className="mb-panel-y text-section">
          Something went wrong
        </h1>
        <Callout variant="err" label="Error">
          <p className="mb-0">
            {error.message || "An unexpected error occurred."}
          </p>
          {error.digest ? (
            <p className="mt-[6px] mb-0 font-mono text-small">{error.digest}</p>
          ) : null}
        </Callout>
        <div className="mt-section">
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </main>
  );
}
