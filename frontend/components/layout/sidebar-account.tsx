"use client";

import { useCurrentUser } from "@/components/auth/auth-provider";
import { LogoutButton } from "@/components/auth/logout-button";
import { Avatar } from "@/components/ui/avatar";

/** Who is signed in, with a way to log out. Shown at the foot of the sidebar. */
export function SidebarAccount() {
  const viewer = useCurrentUser();

  return (
    <div className="mt-auto flex flex-col items-center gap-2 lg:flex-row lg:gap-3 lg:px-2">
      <Avatar user={viewer} />
      <div className="hidden min-w-0 flex-1 text-body lg:block">
        <p className="truncate font-semibold">{viewer.displayName}</p>
        <p className="truncate text-muted">@{viewer.username}</p>
      </div>
      <span className="sr-only lg:hidden">
        Signed in as {viewer.displayName}
      </span>
      <LogoutButton variant="icon" />
    </div>
  );
}
