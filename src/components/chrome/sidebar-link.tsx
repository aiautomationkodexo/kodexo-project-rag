"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

/**
 * A sidebar nav item.
 *
 * ACTIVE STATE IS NOT A RED FILL. The reference dashboards tint the whole
 * active row red; here red is rationed to one run per view and that run is the
 * page's primary action. So active reads as: n100 surface + ink text + a 2px
 * red edge marker. The marker is chrome (counted once globally, like the
 * the logo mark), not a second red run — one 2px sliver cannot compete with
 * a filled button for the eye.
 *
 * `exact` exists for /dashboard: every route would otherwise prefix-match "/".
 */
export function SidebarLink({
  href,
  icon,
  children,
  exact = false,
}: {
  href: Route;
  icon: React.ReactNode;
  children: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-[10px] rounded-box py-[7px] pl-panel-x pr-cell-x font-body text-small transition-colors ${
        active
          ? "bg-n100 font-bold text-ink"
          : "text-n600 hover:bg-n50 hover:text-ink"
      }`}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-[6px] bottom-[6px] w-[2px] bg-red"
        />
      ) : null}
      <span className={active ? "text-ink" : "text-n500"}>{icon}</span>
      {children}
    </Link>
  );
}
