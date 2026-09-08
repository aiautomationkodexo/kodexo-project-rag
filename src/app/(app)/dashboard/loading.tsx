import {
  SkeletonPageHeader,
  SkeletonStatGrid,
  SkeletonTable,
} from "@/components/ui/skeleton";

/**
 * The dashboard fires five COUNT queries plus a recent-projects read, so it is
 * the slowest first paint in the app. The skeleton mirrors its real layout —
 * header, tile row, table — so the shell is legible immediately and nothing
 * shifts when the data lands.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatGrid tiles={5} />
      <SkeletonTable rows={6} columns={5} />
    </>
  );
}
