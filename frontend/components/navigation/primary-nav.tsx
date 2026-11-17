"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, navItems } from "./nav-items";

/** Icons only from 640px, with names from 1024px. */
export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon, activeIcon: ActiveIcon }) => {
          const active = isActivePath(pathname, href);
          const Glyph = active ? ActiveIcon : Icon;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex size-9 items-center justify-center gap-2 rounded-item text-control font-semibold focus-ring motion-safe:transition lg:w-full lg:justify-start lg:px-2 ${
                  active
                    ? "surface-raised text-primary"
                    : "text-secondary hover:bg-edge/4 hover:text-primary"
                }`}
              >
                <Glyph />
                <span className="sr-only lg:not-sr-only">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
