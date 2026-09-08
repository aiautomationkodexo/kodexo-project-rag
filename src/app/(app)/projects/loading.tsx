import { SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/**
 * A `?q=` render waits on an OpenAI embedding before the RPC even starts, so
 * this boundary is doing real work — without it the previous page simply hangs
 * with no acknowledgement of the click.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonTable rows={8} columns={5} />
    </>
  );
}
