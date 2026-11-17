"use client";

import Link from "next/link";
import { useCurrentUser } from "@/components/auth/auth-provider";
import { Avatar } from "@/components/ui/avatar";

/** The signed-in user, linking to their profile; just the avatar on the rail. */
export function ProfileChip() {
  const viewer = useCurrentUser();

  return (
    <Link
      href="/profile"
      className="flex min-w-0 items-center gap-2 rounded-chip p-2 focus-ring motion-safe:transition hover:bg-edge/4 lg:flex-1"
    >
      <Avatar user={viewer} size="sm" />
      <span className="sr-only min-w-0 flex-col lg:not-sr-only lg:flex">
        <span className="truncate text-control font-semibold text-primary">
          {viewer.displayName}
        </span>{" "}
        <span className="truncate text-meta font-medium text-muted">@{viewer.username}</span>
      </span>
    </Link>
  );
}
