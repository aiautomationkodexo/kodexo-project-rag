import Link from "next/link";
import type { Route } from "next";

/**
 * The dashboard KPI tile.
 *
 * WHY THESE ARE NOT COLOURED. The reference dashboards tint each tile a
 * different hue — blue "in stock", green "assigned", amber "in repair", red
 * "lost". Two DESIGN.md rules block that copy directly: Tier 4 illustration is
 * "ONE hue per document", and Tier 3 semantic pairs are locked and reserved
 * for states that genuinely need attention (see status-chip.tsx on why
 * tone-warn is deliberately unallocated).
 *
 * A five-colour tile row also carries no information — the colours encode
 * nothing beyond "this is a different tile", and they spend the whole semantic
 * palette on decoration, leaving nothing louder for a real failure. So the
 * hierarchy is typographic instead: label in the n600 label tier, value in
 * display 900 at --text-section. The value is the biggest thing on the row,
 * which is the actual job.
 *
 * `tone` exists for the ONE tile that reports a genuine problem (failed
 * documents, tags awaiting review). It tints the value only, never the tile,
 * and callers are expected to pass it at most once per row.
 */

type Tone = "default" | "err" | "ok";

const VALUE_TONES: Record<Tone, string> = {
  default: "text-ink",
  err: "text-err-ink",
  ok: "text-ok-ink",
};

type StatCardProps = {
  label: string;
  value: number | string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: Tone;
  href?: Route;
};

function Body({ label, value, hint, icon, tone = "default" }: StatCardProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-cell-x">
        <p className="mb-0 font-body text-label font-bold uppercase tracking-label text-n600">
          {label}
        </p>
        {icon ? <span className="shrink-0 text-n400">{icon}</span> : null}
      </div>
      <p
        className={`mt-[6px] mb-0 font-heading text-section font-black tabular-nums tracking-title ${VALUE_TONES[tone]}`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-[2px] mb-0 text-caption text-n500">{hint}</p>
      ) : null}
    </>
  );
}

export function StatCard(props: StatCardProps) {
  const base =
    "elev-sm block rounded-box border border-n200 bg-white px-panel-x py-panel-y";

  if (props.href) {
    return (
      <Link
        href={props.href}
        className={`${base} transition-colors hover:border-n300 hover:bg-n50`}
      >
        <Body {...props} />
      </Link>
    );
  }

  return (
    <div className={base}>
      <Body {...props} />
    </div>
  );
}

/**
 * The tile row. `auto-fit` + `minmax` rather than fixed breakpoints: the count
 * of tiles varies with the viewer's claims, so the row has to reflow for two
 * tiles as gracefully as for five without the caller knowing which.
 *
 * `stagger-in` is the SOT's `card-in` keyframe applied to the children in
 * sequence — the 80ms cascade is what stops five tiles arriving as one hard
 * flash. It self-disables under `prefers-reduced-motion`.
 */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="stagger-in grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-cell-x">
      {children}
    </div>
  );
}
