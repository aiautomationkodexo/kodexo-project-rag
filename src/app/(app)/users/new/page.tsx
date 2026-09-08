import { PageHeader } from "@/components/chrome/page-header";
import { requireClaim } from "@/lib/auth/claims";
import { NewUserForm } from "./new-user-form";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const actor = await requireClaim("users:create");

  return (
    <>
      <PageHeader
        kicker="People"
        title="New user"
        description="Create the account and choose what it is permitted to do."
      />
      {/* Sets are not serializable across the RSC boundary — send an array. */}
      <NewUserForm
        actor={{ isSuperAdmin: actor.isSuperAdmin, claims: [...actor.claims] }}
      />
    </>
  );
}
