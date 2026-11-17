"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath } from "@/components/navigation/nav-items";
import { iconButtonClass } from "@/components/ui/icon-button";
import { IconSettings, IconSettingsFilled } from "@/components/ui/icons";
import { Wordmark } from "@/components/ui/wordmark";

/** Phones only; the bottom bar has the rest of the navigation. */
export function MobileHeader() {
  const active = isActivePath(usePathname(), "/settings");
  const Glyph = active ? IconSettingsFilled : IconSettings;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-edge/6 bg-bg/80 px-4 backdrop-blur-lg sm:hidden">
      <Wordmark />
      <Link
        href="/settings"
        aria-label="Settings"
        aria-current={active ? "page" : undefined}
        className={iconButtonClass("ghost", "lg")}
      >
        <Glyph />
      </Link>
    </header>
  );
}
