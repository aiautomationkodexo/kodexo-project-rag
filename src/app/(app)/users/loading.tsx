import { SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonTable rows={8} columns={5} />
    </>
  );
}
