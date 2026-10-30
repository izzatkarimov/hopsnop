import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { formatCount } from "@/lib/format";
import type { Profile } from "@/lib/types";

type ProfileHeaderProps = {
  profile: Profile;
  action?: ReactNode;
};

export function ProfileHeader({ profile, action }: ProfileHeaderProps) {
  return (
    <section
      aria-label="Profile details"
      className="border-b border-border px-4 py-4"
    >
      <div className="flex items-start justify-between gap-3">
        <Avatar user={profile} size="lg" />
        {action}
      </div>

      <div className="mt-3">
        <h2 className="text-xl font-semibold leading-tight wrap-break-word">
          {profile.displayName}
        </h2>
        <p className="text-body text-muted">@{profile.username}</p>
      </div>

      {profile.bio && (
        // User-written: only ever rendered as text.
        <p className="mt-3 whitespace-pre-wrap text-body leading-relaxed wrap-break-word">
          {profile.bio}
        </p>
      )}

      <p className="mt-3 flex gap-4 text-body text-muted">
        <Count value={profile.followingCount} label="Following" />
        <Count
          value={profile.followersCount}
          label={profile.followersCount === 1 ? "Follower" : "Followers"}
        />
      </p>
    </section>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <span className="font-semibold text-foreground tabular-nums">
        {formatCount(value)}
      </span>{" "}
      {label}
    </span>
  );
}
