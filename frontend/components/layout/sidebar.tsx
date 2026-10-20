import { PrimaryNav } from "@/components/navigation/primary-nav";
import { Wordmark } from "@/components/ui/wordmark";
import { SidebarAccount } from "./sidebar-account";

/** Left navigation column for tablet and desktop. Hidden on mobile. */
export function Sidebar() {
  return (
    <header className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col items-center gap-6 px-3 py-4 sm:flex lg:w-64 lg:items-stretch">
      <div className="lg:px-2">
        <Wordmark compactOnTablet />
      </div>

      <PrimaryNav />

      <SidebarAccount />
    </header>
  );
}
