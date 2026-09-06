import { AppShell } from "@/components/chrome/app-shell";
import { PageHeader } from "@/components/chrome/page-header";
import { requireClaim } from "@/lib/auth/claims";
import { NewProjectForm } from "./new-project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await requireClaim("projects:create");

  return (
    <AppShell>
      <PageHeader title="New project" />
      {/* The form renders FileDropzone itself; the slot stays open for a
          caller that needs a different queue UI. */}
      <NewProjectForm />
    </AppShell>
  );
}
