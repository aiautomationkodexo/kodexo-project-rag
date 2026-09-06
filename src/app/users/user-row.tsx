import Link from "next/link";
import { Chip } from "@/components/ui/chip";
import { formatDate } from "@/lib/format";
import { CLAIM_LABELS } from "@/lib/auth/claim-set";
import type { UserListItem } from "@/lib/users/queries";

const MAX_CLAIMS = 3;

export function UserRow({ user }: { user: UserListItem }) {
  // A super admin holds every claim implicitly and has no user_claims rows —
  // listing "0 permissions" for them would be actively misleading.
  const shown = user.claims.slice(0, MAX_CLAIMS);
  const overflow = user.claims.length - shown.length;

  return (
    <article className="rule-hair py-panel-y">
      <div className="flex flex-wrap items-baseline justify-between gap-gutter">
        <h2 className="min-w-0 font-display text-subhead font-bold">
          <Link href={`/users/${user.id}`} className="hover:text-red-deep">
            {user.name?.trim() || user.email}
          </Link>
        </h2>
        <div className="flex items-center gap-[8px]">
          {user.is_active ? null : <Chip tone="neutral">Inactive</Chip>}
          <span className="text-small text-n500">
            {formatDate(user.created_at)}
          </span>
        </div>
      </div>

      {user.name?.trim() ? (
        <p className="mt-[4px] mb-0 font-mono text-small text-n500">
          {user.email}
        </p>
      ) : null}

      <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
        {user.is_super_admin ? (
          <Chip tone="invert" title="Holds every permission implicitly">
            Super admin
          </Chip>
        ) : shown.length > 0 ? (
          <>
            {shown.map((claim) => (
              <Chip key={claim} title={CLAIM_LABELS[claim]}>
                {claim}
              </Chip>
            ))}
            {overflow > 0 ? (
              <span className="text-label uppercase tracking-label text-n500">
                +{overflow}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-label uppercase tracking-label text-n500">
            No permissions
          </span>
        )}
      </div>
    </article>
  );
}
