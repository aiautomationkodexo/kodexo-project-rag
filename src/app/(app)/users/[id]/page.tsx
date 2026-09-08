import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/chrome/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { requireClaim } from "@/lib/auth/claims";
import { can } from "@/lib/auth/claim-set";
import { getUser, countActiveSuperAdmins } from "@/lib/users/queries";
import { formatDate } from "@/lib/format";
import { ProfileForm } from "./profile-form";
import { ClaimsForm } from "./claims-form";
import { DangerZone } from "./danger-zone";
import { GrantsForm } from "./grants-form";

export const dynamic = "force-dynamic";

export default async function UserPage(props: PageProps<"/users/[id]">) {
  const actor = await requireClaim("users:view");
  const { id } = await props.params;

  const data = await getUser(id);
  if (!data) notFound();

  const { profile, claims, grants } = data;
  const canUpdate = can(actor, "users:update");
  const canDelete = can(actor, "users:delete");
  const isSelf = actor.id === profile.id;

  // Only relevant when this account IS the constraint.
  const superAdmins = profile.is_super_admin ? await countActiveSuperAdmins() : 0;
  const isLastSuperAdmin = profile.is_super_admin && superAdmins <= 1;

  const actorForGrid = {
    isSuperAdmin: actor.isSuperAdmin,
    claims: [...actor.claims],
  };

  return (
    <>
      <PageHeader
        kicker="People"
        title={profile.name?.trim() || profile.email}
        meta={
          <div className="flex flex-wrap items-center gap-[6px]">
            <span className="font-mono text-small text-n500">{profile.email}</span>
            {profile.is_super_admin ? <Chip tone="invert">Super admin</Chip> : null}
            {profile.is_active ? <Chip tone="ok">Active</Chip> : <Chip tone="neutral">Inactive</Chip>}
          </div>
        }
      />

      <p className="mb-panel-y">
        <Link
          href="/users"
          className="font-body text-label font-bold uppercase tracking-label text-n600 underline underline-offset-2 hover:text-ink"
        >
          ← All users
        </Link>
      </p>

      <div className="grid gap-cell-x lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <CardContent>
            {canUpdate ? (
              <ProfileForm
                userId={profile.id}
                name={profile.name ?? ""}
                email={profile.email}
              />
            ) : (
              <p className="mb-0 text-body text-n500">
                {profile.name?.trim() || "No name set"} · {profile.email}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Permissions"
            description="What this account is allowed to do."
          />
          <CardContent>
            <ClaimsForm
              userId={profile.id}
              actor={actorForGrid}
              initial={[...claims]}
              isSuperAdmin={profile.is_super_admin}
              canEdit={canUpdate}
              isSelf={isSelf}
            />
          </CardContent>
        </Card>
      </div>

      {/* Per-project access. Only for users:update holders — the grant write
          is gated on that claim in RLS, so rendering it otherwise would offer
          a control guaranteed to 42501. Super admins are excluded: they pass
          every claim check by short-circuit, so a grant would be inert. */}
      {canUpdate && !profile.is_super_admin ? (
        <div className="mt-cell-x">
          <Card>
            <CardHeader
              title="Per-project access"
              description="Grants are additive — they widen access and never restrict it."
            />
            <CardContent>
              <GrantsForm
                userId={profile.id}
                grants={grants}
                hasGlobalView={claims.has("projects:view")}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="mt-cell-x">
        <DangerZone
          userId={profile.id}
          email={profile.email}
          isActive={profile.is_active}
          canUpdate={canUpdate}
          canDelete={canDelete}
          isSelf={isSelf}
          isLastSuperAdmin={isLastSuperAdmin}
        />
      </div>

      <footer className="mt-section border-t border-n200 pt-panel-y">
        <p className="mb-0 text-caption text-n500">
          Created {formatDate(profile.created_at)} · Last updated{" "}
          {formatDate(profile.updated_at)}
        </p>
      </footer>
    </>
  );
}
