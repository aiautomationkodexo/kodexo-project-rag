import { PageHeader } from "@/components/chrome/page-header";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCheck } from "@/components/ui/icon";
import { requireClaim } from "@/lib/auth/claims";
import { listMergeTargets, listUnapprovedTags } from "@/lib/tags/queries";
import { TagRow } from "./tag-row";

export const dynamic = "force-dynamic";

/**
 * PRD §12 /admin/tags — the review queue for tags the summariser invented.
 *
 * Gated on 'tags:manage' rather than is_super_admin (0011). Curation is
 * ongoing work that grows with every finalize, and requiring super admin meant
 * the only way to delegate it was to also hand over user management and the
 * audit log.
 *
 * No `action` on the PageHeader: the primary actions here are per-row, and the
 * red ration is one run per view. Spending it on a header button that did
 * nothing to a specific tag would be spending it on nothing.
 */
export default async function AdminTagsPage() {
  await requireClaim("tags:manage");

  const [tags, targets] = await Promise.all([
    listUnapprovedTags(),
    listMergeTargets(),
  ]);

  return (
    <>
      <PageHeader
        kicker="Curation"
        title="Tag review"
        description="Technology tags the summariser created that no one has confirmed yet."
        meta={
          tags.length > 0 ? (
            <span className="text-label font-bold uppercase tracking-label text-n700">
              {tags.length} awaiting review
            </span>
          ) : null
        }
      />

      {tags.length > 0 ? (
        <>
          <Callout variant="info" label="Why these are here" className="mb-section">
            <p className="mb-0">
              The summariser creates a tag whenever a technology name matches no
              known alias. Approve the ones that are real, and merge the ones
              that are another spelling of a tag you already have — merging
              records the spelling as an alias, so the same variant resolves on
              its own from then on.
            </p>
          </Callout>

          <Card>
            <CardHeader
              title="Awaiting review"
              description="Ordered by how many projects carry the tag."
            />
            <CardContent flush>
              {tags.map((tag) => (
                <TagRow key={tag.id} tag={tag} targets={targets} />
              ))}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={<IconCheck />}
              title="Nothing awaiting review."
              body="Every technology tag in use has been approved. New ones appear here automatically when a project is summarised."
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
