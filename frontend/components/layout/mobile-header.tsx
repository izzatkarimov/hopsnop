import Link from "next/link";
import { SettingsIcon } from "@/components/ui/icons";
import { Wordmark } from "@/components/ui/wordmark";

/** Compact top bar shown only on mobile, above the page content. */
export function MobileHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background px-3 sm:hidden">
      <Wordmark />
      <Link
        href="/settings"
        className="rounded-full p-2 text-muted transition-colors hover:bg-hover hover:text-foreground"
      >
        <SettingsIcon />
        <span className="sr-only">Settings</span>
      </Link>
    </header>
  );
}
