import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/claims";
import { can } from "@/lib/auth/claim-set";
import { BUCKET } from "@/lib/pipeline/extract";
import {
  classifyFile,
  sanitizeStorageFilename,
  MAX_FILES_PER_PROJECT,
} from "@/lib/uploads/mime";

/**
 * Mints a one-shot signed upload URL so the browser can PUT straight to
 * Storage, bypassing Vercel's 4.5 MB request-body limit entirely.
 *
 * THIS IS THE FIRST COOKIE-AUTHENTICATED ROUTE UNDER /api. Every other one
 * (process, finalize, cron) is machine-to-machine and authenticates with a
 * shared secret, which is why `/api` is excluded from the proxy matcher. That
 * exclusion must stay — adding /api back would 307 the machine routes to
 * /login. This route therefore authenticates itself via getCurrentUser().
 *
 * The document id is minted HERE and returned to the client, so the storage
 * key and the eventual `documents` row agree without a second round trip. On
 * the create path the project id is minted too, which is what removes any need
 * for a staging bucket or a later `storage.move`.
 */

export const dynamic = "force-dynamic";

type Body = {
  intent?: "create" | "add";
  projectId?: string;
  filename?: string;
  mime?: string;
  size?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  const intent = body.intent === "add" ? "add" : "create";
  const claim = intent === "add" ? "projects:update" : "projects:create";
  if (!can(user, claim)) {
    return Response.json({ error: `Missing permission: ${claim}` }, { status: 403 });
  }

  const filename = String(body.filename ?? "");
  const verdict = classifyFile({
    filename,
    declaredMime: String(body.mime ?? ""),
    size: Number(body.size ?? 0),
  });
  if (!verdict.ok) {
    return Response.json({ error: verdict.reason }, { status: 400 });
  }

  let projectId: string;

  if (intent === "add") {
    if (!body.projectId || !UUID.test(body.projectId)) {
      return Response.json({ error: "Missing project id." }, { status: 400 });
    }
    projectId = body.projectId;

    // Through the USER's client, so RLS re-proves they can see this project.
    const supabase = await createClient();
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    // Courtesy pre-check so the user is told before uploading 50 MB. The
    // authority is addFilesToProject, which re-counts inside the action.
    const { count } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("is_active", true)
      .eq("is_synthetic", false);
    if ((count ?? 0) >= MAX_FILES_PER_PROJECT) {
      return Response.json(
        { error: `A project can hold at most ${MAX_FILES_PER_PROJECT} files.` },
        { status: 409 },
      );
    }
  } else {
    // The client may carry a project id it minted for this form session, so
    // several files share one key prefix before the project row exists.
    projectId = body.projectId && UUID.test(body.projectId) ? body.projectId : randomUUID();
  }

  const documentId = randomUUID();
  // PRD §5 path convention. The display name stays intact on documents.filename;
  // only the key is sanitised.
  const storageKey = `projects/${projectId}/${documentId}/${sanitizeStorageFilename(filename)}`;

  // Service role: the signed URL is the client's authorization to write exactly
  // this one object, so it must be minted by something that can.
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(storageKey);

  if (error || !data) {
    return Response.json(
      { error: error?.message ?? "Could not prepare the upload." },
      { status: 500 },
    );
  }

  return Response.json({
    projectId,
    documentId,
    storageKey,
    canonicalMime: verdict.canonicalMime,
    signedUrl: data.signedUrl,
    token: data.token,
  });
}
