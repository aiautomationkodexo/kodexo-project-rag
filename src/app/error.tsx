"use client";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-doc flex-1 flex-col justify-center px-shell py-section">
      <h1 className="mb-panel-y font-display text-section font-black tracking-title">
        Something went wrong
      </h1>
      <Callout variant="err" label="Error">
        <p className="mb-0">{error.message || "An unexpected error occurred."}</p>
        {error.digest ? (
          <p className="mt-[6px] mb-0 font-mono text-small">{error.digest}</p>
        ) : null}
      </Callout>
      <div className="mt-section">
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
