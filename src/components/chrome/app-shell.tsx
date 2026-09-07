import Link from "next/link";
import { Wordmark } from "./wordmark";
import { NavLink } from "./nav-link";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/claims";
import { can } from "@/lib/auth/claim-set";

/**
 * DESIGN.md §6 ContentPage, adapted.
 *
 * The A4 running furniture becomes a top bar: KODEXO LABS at .16em on the left
 * (§4's running head), nav on the right, hairline rule beneath. Page numbers,
 * `Confidential`, and every breakInside/breakAfter rule are print-only and
 * dropped.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <>
      <header className="rule-hair">
        <div className="mx-auto flex w-full max-w-doc items-center justify-between gap-gutter px-shell py-panel-y">
          <Link href="/projects" className="tracking-head">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-gutter">
            <NavLink href="/projects">Projects</NavLink>
            {can(user, "users:view") ? (
              <NavLink href="/users">Users</NavLink>
            ) : null}
            {can(user, "tags:manage") ? (
              <NavLink href="/admin/tags">Tags</NavLink>
            ) : null}
            {user ? (
              <form action="/auth/signout" method="get">
                <Button variant="ghost" size="sm" type="submit">
                  Sign out
                </Button>
              </form>
            ) : null}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-doc flex-1 px-shell py-section">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-doc px-shell pb-section">
        <p className="mb-0 text-label uppercase tracking-label text-n500">
          Kodexo Labs · Internal · Confidential
        </p>
      </footer>
    </>
  );
}
