import { notFound } from "next/navigation";
import { AppShell } from "@/components/chrome/app-shell";
import { PageHeader } from "@/components/chrome/page-header";
import { Chip } from "@/components/ui/chip";
import { Callout } from "@/components/ui/callout";
import { requireClaim } from "@/lib/auth/claims";
import { can } from "@/lib/auth/claim-set";
import { getUser, countActiveSuperAdmins } from "@/lib/users/queries";
import { formatDate } from "@/lib/format";
import { ProfileForm } from "./profile-form";
import { ClaimsForm } from "./claims-form";
import { DangerZone } from "./danger-zone";

export const dynamic = "force-dynamic";

export default async function UserPage(props: PageProps<"/users/[id]">) {
  const actor = await requireClaim("users:view");
  const { id } = await props.params;

  const data = await getUser(id);
  if (!data) notFound();

  const { profile, claims } = data;
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
    <AppShell>
      <PageHeader
        title={profile.name?.trim() || profile.email}
        meta={
          <div className="flex flex-wrap items-center gap-[6px]">
            <span className="font-mono text-small text-n500">{profile.email}</span>
            {profile.is_super_admin ? <Chip tone="invert">Super admin</Chip> : null}
            {profile.is_active ? null : <Chip tone="neutral">Inactive</Chip>}
          </div>
        }
      />

      {isLastSuperAdmin ? (
        <Callout variant="info" label="Last super admin" className="mb-section">
          <p className="mb-0">
            This is the only active super admin, so the database will refuse to
            deactivate or delete it. Promote another account first — via the
            seed script — if you need to retire this one.
          </p>
        </Callout>
      ) : null}

      <section className="mb-section">
        <h2 className="rule-hair mb-panel-y pb-[5px] font-display text-subhead font-bold">
          Details
        </h2>
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
      </section>

      <section>
        <h2 className="rule-hair mb-panel-y pb-[5px] font-display text-subhead font-bold">
          Permissions
        </h2>
        <ClaimsForm
          userId={profile.id}
          actor={actorForGrid}
          initial={[...claims]}
          isSuperAdmin={profile.is_super_admin}
          canEdit={canUpdate}
        />
      </section>

      <DangerZone
        userId={profile.id}
        email={profile.email}
        isActive={profile.is_active}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSelf={isSelf}
      />

      <footer className="mt-section border-t border-n200 pt-panel-y">
        <p className="mb-0 text-small text-n500">
          Created {formatDate(profile.created_at)} · Last updated{" "}
          {formatDate(profile.updated_at)}
        </p>
      </footer>
    </AppShell>
  );
}
