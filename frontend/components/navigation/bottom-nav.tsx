"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NewPostButton } from "@/components/layout/new-post-button";
import { isActivePath, navItems } from "./nav-items";

const items = navItems.filter((item) => item.inBottomNav);

/** Phones only: a floating bar with New post in the middle. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 mx-auto max-w-sm rounded-full surface-glass sm:hidden"
    >
      <ul className="flex h-16 items-center justify-around px-2">
        {items.map(({ href, label, icon: Icon, activeIcon: ActiveIcon }, index) => {
          const active = isActivePath(pathname, href);
          const Glyph = active ? ActiveIcon : Icon;
          return (
            <Fragment key={href}>
              {index === Math.ceil(items.length / 2) && (
                <li>
                  <NewPostButton placement="bottom-bar" />
                </li>
              )}
              <li>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex size-12 items-center justify-center rounded-full focus-ring motion-safe:transition ${
                    active ? "text-primary" : "text-secondary hover:text-primary"
                  }`}
                >
                  <Glyph size={24} />
                  <span className="sr-only">{label}</span>
                </Link>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}
