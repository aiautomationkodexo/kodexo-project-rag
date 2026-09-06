"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

/** Active state is the one red use in the shell (DESIGN.md §9). */
export function NavLink({
  href,
  children,
}: {
  href: Route;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`border-b-2 pb-[2px] font-body text-label uppercase tracking-label transition-colors ${
        active
          ? "border-red text-ink"
          : "border-transparent text-n500 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
