import { LogoutButton } from "@/components/auth/logout-button";
import { PrimaryNav } from "@/components/navigation/primary-nav";
import { Wordmark } from "@/components/ui/wordmark";
import { NewPostButton } from "./new-post-button";
import { ProfileChip } from "./profile-chip";

/** A 72px rail from 640px, the full 240px sidebar from 1024px. */
export function Sidebar() {
  return (
    <header className="sticky top-6 hidden h-[calc(100dvh-3rem)] w-18 shrink-0 flex-col justify-between sm:flex lg:w-60">
      <div className="flex flex-col items-center gap-9 lg:items-stretch">
        <Wordmark compactOnTablet />
        <PrimaryNav />
      </div>

      <div className="flex flex-col items-center gap-4 lg:items-stretch">
        <NewPostButton placement="sidebar" />
        {/* Wraps on the rail: the log out button goes under the avatar. */}
        <div className="flex flex-wrap items-center justify-center gap-1 lg:justify-start">
          <ProfileChip />
          <LogoutButton variant="icon" />
        </div>
      </div>
    </header>
  );
}
