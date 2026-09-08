import { AppShell } from "@/components/chrome/app-shell";

/**
 * The shell for every signed-in surface.
 *
 * WHY A ROUTE GROUP. `(app)` groups the authed pages without adding a URL
 * segment, so /projects stays /projects. Before this, every page imported
 * `AppShell` itself and rendered it inside the page body — which meant the
 * rail was part of the page, so it was torn down and rebuilt on every
 * navigation. A layout persists across navigations within the group: the rail
 * keeps its scroll position and stays interactive while the next page streams.
 *
 * /login is deliberately OUTSIDE this group. It is the app's cover — full
 * bleed, no rail, no nav — and it has no user to render a rail for.
 *
 * No auth check lives here. Layouts do not re-run on every navigation, so a
 * guard placed here would not be re-evaluated when a session is revoked
 * mid-session. Each page calls `requireClaim` itself, which is also what the
 * proxy's non-boundary status demands (CLAUDE.md: authorization is three
 * layers and RLS is the actual one).
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
