/**
 * Loading placeholders for `loading.tsx`.
 *
 * `animate-pulse` is Tailwind's opacity keyframe. A skeleton gets NO `elev-*`:
 * it stands in for content that has not arrived, and lifting a placeholder off
 * the page implies substance that is not there yet.
 *
 * Skeletons mirror the LAYOUT they replace (a header block, then a table of N
 * rows) rather than showing a centred spinner. A spinner tells the user only
 * that something is happening; a skeleton also tells them what is about to
 * appear and reserves its space, so the page does not jump when it lands.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-box bg-n100 ${className}`} />
  );
}

export function SkeletonPageHeader() {
  return (
    <div className="mb-section">
      <Skeleton className="h-[11px] w-[90px]" />
      <Skeleton className="mt-[8px] h-[26px] w-[240px]" />
    </div>
  );
}

export function SkeletonStatGrid({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="mb-section grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-cell-x">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="rounded-box border border-n200 px-panel-x py-panel-y">
          <Skeleton className="h-[10px] w-[70px]" />
          <Skeleton className="mt-[10px] h-[22px] w-[48px]" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="rounded-box border border-n200">
      <div className="flex gap-cell-x border-b border-n200 bg-n50 px-cell-x py-cell-y">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-[10px] flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="flex gap-cell-x border-b border-n200 px-cell-x py-[13px] last:border-b-0"
        >
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-[10px] flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
