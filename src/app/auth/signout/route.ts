import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign-out, as a Route Handler rather than a Server Action.
 *
 * signOut() writes cookies, and a Server Component cannot. This route is
 * therefore how a page render forces a logout — which is exactly what
 * requireUser() needs when it discovers a deactivated account. That is what
 * makes deactivation take effect on the next navigation (PRD §14 T3).
 */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("reason");

  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect(reason === "deactivated" ? "/login?error=deactivated" : "/login");
}

export const POST = GET;
