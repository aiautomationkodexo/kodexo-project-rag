import "server-only";

import { publicEnv } from "@/lib/env.public";
import { createAdminClient } from "@/lib/supabase/admin";

import { escapeHtml } from "./html";
import { sendMail } from "./send";

/** What finalizeProject actually did. Drives the email copy, nothing else. */
export type FinalizeOutcome = "summarized" | "empty" | "error";

/**
 * Completion email for one finalize round (PRD §10).
 *
 * NEVER THROWS. Called from maybeFinalize on the success path; see the comment
 * there for why it deliberately lives OUTSIDE finalizeProject's §15.9
 * try/catch.
 *
 * Not gated on any "already emailed?" flag or column: claim_finalize is the
 * single finalization gate (§15.6), so exactly one invocation reaches this per
 * round. A later add-files round legitimately produces a second email.
 */
export async function notifyProjectReady(
  projectId: string,
  outcome: Exclude<FinalizeOutcome, "error">,
): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: project } = await admin
      .from("projects")
      .select("id, title, last_updated_by, created_by")
      .eq("id", projectId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!project) return;

    // last_updated_by is stamped on create, edit and add-files, so it is always
    // the person whose action triggered THIS finalize — a better recipient than
    // created_by, which is only right for the first round. Read from the row
    // rather than passed in, because the cron sweep can be the finalize winner
    // and has no user context at all.
    const recipientId = project.last_updated_by ?? project.created_by;
    if (!recipientId) return;

    // profiles_select does NOT reference deleted_at, so the app layer must
    // filter it (see CLAUDE.md). is_active matters too: a deactivated account
    // is forced through /auth/signout on its next request, so the link would be
    // useless to them anyway.
    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("id", recipientId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (!profile?.email) return;

    const url = `${publicEnv.siteUrl}/projects/${project.id}`;
    const title = project.title;

    // "empty" means every document failed extraction. Mail it anyway, with
    // different copy: the user is watching a live status panel, and silence
    // when everything failed is worse than a short note saying so.
    const subject =
      outcome === "summarized"
        ? `"${title}" is ready`
        : `"${title}" finished with no readable content`;

    const lead =
      outcome === "summarized"
        ? "Processing finished and the summary is up to date."
        : "Processing finished, but no text could be extracted from the " +
          "documents on this project. Open it to see which files failed.";

    await sendMail({
      to: profile.email,
      subject,
      text: `${title}\n\n${lead}\n\n${url}\n`,
      html:
        `<p><strong>${escapeHtml(title)}</strong></p>` +
        `<p>${lead}</p>` +
        `<p><a href="${url}">Open the project</a></p>`,
    });
  } catch (error) {
    // Belt to sendMail's braces. maybeFinalize's success path must be
    // structurally incapable of failing here.
    console.error(`[email:project-ready] ${projectId}:`, error);
  }
}
