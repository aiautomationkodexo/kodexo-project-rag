import { PageHeader } from "@/components/chrome/page-header";
import { requireClaim } from "@/lib/auth/claims";
import { NewProjectForm } from "./new-project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await requireClaim("projects:create");

  return (
    <>
      <PageHeader
        kicker="Portfolio"
        title="New project"
        description="Describe the work, attach any documents, and the pipeline writes the summary."
      />
      {/* The form renders FileDropzone itself; the slot stays open for a
          caller that needs a different queue UI. */}
      <NewProjectForm />
    </>
  );
}
