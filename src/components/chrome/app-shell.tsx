import Link from "next/link";
import { AppSidebar } from "./app-sidebar";
import { Logo } from "./logo";
import { SidebarLink } from "./sidebar-link";
import {
  IconDashboard,
  IconProjects,
  IconSignOut,
  IconTags,
  IconUsers,
} from "@/components/ui/icon";
import { getCurrentUser } from "@/lib/auth/claims";
import { can } from "@/lib/auth/claim-set";

/**
 * The dashboard shell: a fixed rail beside a scrolling content column.
 *
 * WHY THE RAIL IS `fixed` AND NOT A FLEX SIBLING. A flex row makes the whole
 * document the scroll container, so the rail scrolls away with the table —
 * which defeats the point of persistent navigation on exactly the long pages
 * that need it. Fixed + a matching `pl-rail` on the content keeps the rail put
 * while the content scrolls, with no nested scroll container to trap the
 * wheel.
 *
 * MOBILE. Below `md` the rail would eat 240px of a 375px viewport, so it is
 * hidden and replaced by a top bar carrying the same links. This is a
 * disclosure of the same nav, not a second nav: both read the same claims and
 * render the same `SidebarLink`s, so an item can never appear in one and not
 * the other.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const showUsers = can(user, "users:view");
  const showTags = can(user, "tags:manage");

  return (
    <div className="min-h-full">
      <div className="fixed inset-y-0 left-0 z-20 hidden md:block">
        <AppSidebar user={user} />
      </div>

      {/* Mobile chrome. `overflow-x-auto` rather than a hamburger: with at most
          four destinations a scrollable strip is one tap to anywhere, and it
          needs no client state, no focus trap and no escape handling. */}
      <header className="sticky top-0 z-20 border-b border-n200 bg-n50 md:hidden">
        <div className="flex items-center justify-between px-shell py-panel-y">
          <Link href="/dashboard" aria-label="Kodexo Labs — dashboard">
            <Logo height={22} priority />
          </Link>
          {user ? (
            <form action="/auth/signout" method="get">
              <button
                type="submit"
                className="flex items-center gap-[6px] rounded-box font-body text-caption text-n600"
              >
                <IconSignOut size={14} />
                Sign out
              </button>
            </form>
          ) : null}
        </div>
        <nav className="flex gap-[4px] overflow-x-auto px-[8px] pb-[8px]">
          <SidebarLink href="/dashboard" icon={<IconDashboard />} exact>
            Dashboard
          </SidebarLink>
          <SidebarLink href="/projects" icon={<IconProjects />}>
            Projects
          </SidebarLink>
          {showUsers ? (
            <SidebarLink href="/users" icon={<IconUsers />}>
              Users
            </SidebarLink>
          ) : null}
          {showTags ? (
            <SidebarLink href="/admin/tags" icon={<IconTags />}>
              Tags
            </SidebarLink>
          ) : null}
        </nav>
      </header>

      <div className="md:pl-rail">
        <main className="mx-auto w-full max-w-app px-shell py-section">
          {children}
        </main>
      </div>
    </div>
  );
}
