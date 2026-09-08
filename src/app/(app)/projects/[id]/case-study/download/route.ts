import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/claims";
import { can } from "@/lib/auth/claim-set";
import { BUCKET } from "@/lib/pipeline/extract";

/**
 * Downloads a project's generated case study outline (migration 0018).
 *
 * ── WHY THIS LIVES UNDER /projects AND NOT UNDER /api ─────────────────────
 * `/api` is excluded from the proxy matcher, and CLAUDE.md records that the
 * exclusion is load-bearing: those routes are machine-to-machine and
 * authenticate with a shared secret, so putting them behind the proxy 307s
 * them to /login and (for dispatch) silently returns a 200 from the login
 * page. /api/upload-url is documented as THE ONLY cookie-authenticated route
 * under /api; adding a second would erode a boundary the codebase states
 * explicitly.
 *
 * Sitting under /projects instead, this route gets proxy coverage for free —
 * and still authenticates itself, because the proxy is not a security
 * boundary: a matcher change can silently remove its coverage.
 *
 * ── WHY IT REDIRECTS TO A SIGNED URL RATHER THAN STREAMING ────────────────
 * Streaming would pull the whole DOCX through the function to hand it
 * straight back out, paying for the bytes twice and bounding the file by the
 * invocation's memory. A short-lived signed URL lets Storage serve it. The
 * bucket is private, so the URL is the only way in, and it expires.
 */

export const dynamic = "force-dynamic";

/**
 * Deliberately short. The URL is followed IMMEDIATELY by the browser that was
 * just redirected — it does not need to survive being shared, and a long TTL
 * turns a copied link into an unauthenticated download that outlives the
 * viewer's session.
 */
const TTL_SECONDS = 60;

export async function GET(
  _request: Request,
  context: RouteContext<"/projects/[id]/case-study/download">,
) {
  const { id } = await context.params;

  // Authenticated here, not inherited from the proxy. Same discipline every
  // Server Action follows.
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Not signed in.", { status: 401 });
  }
  if (!can(user, "projects:view")) {
    return new Response("Missing permission: projects:view", { status: 403 });
  }

  /*
   * Through the USER's client, so RLS is the boundary rather than the claim
   * check above: projects_select filters `deleted_at is null` and
   * case_study_select re-checks projects:view. A soft-deleted project's
   * outline therefore stops being downloadable the moment it is deleted,
   * without this route knowing anything about deleted_at.
   *
   * The join also proves the outline belongs to a project the caller can see,
   * which is what stops a bare row id from being a way around visibility.
   */
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("project_case_study")
    .select("storage_key, filename, projects!inner(id)")
    .eq("project_id", id)
    .maybeSingle();

  if (!row) {
    return new Response("No case study outline for this project.", {
      status: 404,
    });
  }

  // Null is a legal state (0018): the generation succeeded but the upload
  // failed, or the 0009 purge reclaimed the bytes of a soft-deleted project.
  // The page renders the outline regardless, so this is a real 404 rather
  // than an error worth logging.
  if (!row.storage_key) {
    return new Response("This outline has no downloadable file.", {
      status: 404,
    });
  }

  /*
   * Service role, because the bucket is private and the signed URL IS the
   * grant. Authorization already happened above, through the user's client —
   * this client is used only to mint the URL, and it is handed the key that
   * query returned, never one from the request.
   */
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_key, TTL_SECONDS, {
      // Makes the browser save it under the stored name rather than the uuid
      // segment of the key, and forces a download instead of Word's
      // in-browser preview.
      download: row.filename,
    });

  if (error || !data) {
    console.error(`[case-study:download] ${id}:`, error?.message);
    return new Response("Could not prepare the download.", { status: 500 });
  }

  // 302, not 307: this is a GET with no body to preserve, and a temporary
  // redirect keeps the short-lived URL out of any cache that honours 301.
  return Response.redirect(data.signedUrl, 302);
}
