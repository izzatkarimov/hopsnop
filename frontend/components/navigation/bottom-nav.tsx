"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, navItems } from "./nav-items";

/** Mobile-only tab bar fixed to the bottom of the screen. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="flex h-14">
        {navItems
          .filter((item) => item.inBottomNav)
          .map(({ href, label, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-full items-center justify-center ${
                    active ? "text-accent" : "text-muted"
                  }`}
                >
                  <Icon strokeWidth={active ? 2.4 : 1.8} />
                  <span className="sr-only">{label}</span>
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
