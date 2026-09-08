import Link from "next/link";
import { Logo } from "./logo";
import { SidebarLink } from "./sidebar-link";
import {
  IconDashboard,
  IconProjects,
  IconSignOut,
  IconTags,
  IconUsers,
} from "@/components/ui/icon";
import { can } from "@/lib/auth/claim-set";
import type { CurrentUser } from "@/lib/auth/claims";

/**
 * DESIGN.md §6's ContentPage running head, re-cast as a dashboard rail.
 *
 * The print system puts identity in a running head across the top of every
 * A4 page. On screen that costs a full band of vertical space and gives the
 * nav nowhere to grow — four items fit, a fifth does not. The rail spends
 * horizontal space instead, which a 16:9 display has in surplus, and turns the
 * nav into a scannable list with room for grouping.
 *
 * The GROUP KICKERS (`Overview` / `Manage`) use Identity v1.0's
 * `.mono-kicker`, the same device as the page-header kicker. Reusing one
 * treatment for "this names a section" in both places is what makes the rail
 * and the page read as one system rather than two.
 */

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="kicker mt-panel-y mb-2 px-panel-x text-[11px]">{children}</p>;
}

export function AppSidebar({ user }: { user: CurrentUser | null }) {
  const showUsers = can(user, "users:view");
  const showTags = can(user, "tags:manage");

  return (
    <aside className="flex h-full w-rail shrink-0 flex-col border-r border-n200 bg-n50">
      <div className="flex h-[57px] items-center border-b border-n200 px-panel-x">
        <Link href="/dashboard" aria-label="Kodexo Labs — dashboard">
          <Logo height={26} priority />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-[8px] pb-panel-y">
        <GroupLabel>Overview</GroupLabel>
        <SidebarLink href="/dashboard" icon={<IconDashboard />} exact>
          Dashboard
        </SidebarLink>
        <SidebarLink href="/projects" icon={<IconProjects />}>
          Projects
        </SidebarLink>

        {showUsers || showTags ? (
          <>
            <GroupLabel>Manage</GroupLabel>
            {showUsers ? (
              <SidebarLink href="/users" icon={<IconUsers />}>
                Users
              </SidebarLink>
            ) : null}
            {showTags ? (
              <SidebarLink href="/admin/tags" icon={<IconTags />}>
                Tag review
              </SidebarLink>
            ) : null}
          </>
        ) : null}
      </nav>

      {user ? (
        <div className="border-t border-n200 px-panel-x py-panel-y">
          {/* Identity before the action: the rail's foot answers "who am I
              signed in as" first, and only then offers the way out. */}
          <p
            className="mb-0 truncate font-body text-small font-bold text-ink"
            title={user.name?.trim() || user.email}
          >
            {user.name?.trim() || user.email}
          </p>
          <p className="mb-[8px] truncate font-mono text-caption text-n500" title={user.email}>
            {user.email}
          </p>
          <form action="/auth/signout" method="get">
            <button
              type="submit"
              className="flex items-center gap-[6px] rounded-box font-body text-caption text-n600 transition-colors hover:text-ink"
            >
              <IconSignOut size={14} />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </aside>
  );
}
