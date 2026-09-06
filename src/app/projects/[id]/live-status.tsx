"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/client";
import { Callout } from "@/components/ui/callout";
import { StatusChip } from "@/components/ui/status-chip";
import { pluralize } from "@/lib/format";
import type { DocumentRow, ProjectStatus } from "@/lib/types";

/**
 * Live processing status via Supabase Realtime.
 *
 * REACT COMPILER NOTES (it is enabled in next.config.ts):
 *   · The client is created INSIDE the effect. Reading a mutable module binding
 *     during render is impure and the compiler may memoize around it.
 *   · The "already refreshed" guard is a plain `let` in the effect closure, not
 *     a ref — the compiler hard-errors on ref.current reads during render, and
 *     an effect-local binding is the correct scope anyway.
 *   · Every state update produces a NEW object/array. The compiler assumes
 *     immutability; mutating state in place silently fails to re-render.
 *   · Cleanup is removeChannel(channel), NOT channel.unsubscribe() — the
 *     latter leaves the channel registered and leaks one per navigation.
 *
 * If events never arrive, the cause is almost always Realtime authorization
 * rather than the subscription: RLS is applied per subscriber against the
 * socket's JWT.
 */
export function LiveStatus({
  projectId,
  initialStatus,
  initialDocuments,
}: {
  projectId: string;
  initialStatus: ProjectStatus;
  initialDocuments: DocumentRow[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ProjectStatus>(initialStatus);
  const [documents, setDocuments] = useState<DocumentRow[]>(initialDocuments);

  useEffect(() => {
    const supabase = getBrowserClient();
    let refreshed = false;

    const channel = supabase
      .channel(`project:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          const next = (payload.new as { status?: ProjectStatus }).status;
          if (!next) return;
          setStatus(next);
          if (next === "ready" && !refreshed) {
            refreshed = true;
            router.refresh();
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const row = payload.new as Partial<DocumentRow> & { id?: string };
          // Narrow into a local: TypeScript does not carry property narrowing
          // across the closure boundary below.
          const rowId = row?.id;
          if (!rowId) return;
          setDocuments((prev) =>
            prev.some((d) => d.id === rowId)
              ? prev.map((d) =>
                  d.id === row.id
                    ? { ...d, status: row.status ?? d.status, error: row.error ?? null }
                    : d,
                )
              : [
                  ...prev,
                  {
                    id: rowId,
                    filename: row.filename ?? "document",
                    doc_role: row.doc_role ?? null,
                    status: row.status ?? "queued",
                    error: row.error ?? null,
                    is_synthetic: row.is_synthetic ?? false,
                  },
                ],
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, router]);

  if (status === "ready") return null;

  const done = documents.filter((d) => d.status === "done").length;
  const failed = documents.filter((d) => d.status === "failed").length;

  return (
    <div className="mb-section">
      <Callout variant="info" label="Processing">
        <p className="mb-0">
          Documents are being processed in the background.{" "}
          <strong className="font-bold">You can close this page</strong> —
          processing continues and the summary will be here when you return.
        </p>
        {/* Counted text, not a progress bar. A bar implies a time estimate the
            pipeline cannot give: embedding and summarising have wildly
            different durations. */}
        <p className="mt-[8px] mb-0 text-label uppercase tracking-label">
          {done} of {documents.length}{" "}
          {pluralize(documents.length, "document")} processed
          <span className="ml-[8px] inline-block align-middle">
            <StatusChip kind="project" status={status} />
          </span>
        </p>
      </Callout>

      {failed > 0 ? (
        <Callout variant="warn" label="Some documents failed" className="mt-panel-y">
          <p className="mb-0">
            {failed} of {documents.length}{" "}
            {pluralize(documents.length, "document")} could not be processed.
            The summary is built from the rest.
          </p>
        </Callout>
      ) : null}
    </div>
  );
}
