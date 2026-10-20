"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, navItems } from "./nav-items";

/** Sidebar navigation: icon-only on tablet, icon + label on desktop. */
export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-4 rounded-full p-3 text-lg transition-colors hover:bg-hover lg:pr-5 ${
                  active ? "font-semibold" : "text-foreground/80"
                }`}
              >
                <Icon
                  className={active ? "text-accent" : undefined}
                  strokeWidth={active ? 2.4 : 1.8}
                />
                <span className="sr-only lg:not-sr-only">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
