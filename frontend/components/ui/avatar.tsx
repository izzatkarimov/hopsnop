"use client";

import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import type { User } from "@/lib/types";

// Chosen for contrast with white initials.
const colors = [
  "bg-emerald-700",
  "bg-sky-700",
  "bg-violet-700",
  "bg-amber-700",
  "bg-rose-700",
  "bg-teal-700",
  "bg-indigo-700",
  "bg-fuchsia-700",
];

const sizes = {
  xs: "size-5 text-[0.5rem]",
  compact: "size-8 text-xs",
  sm: "size-9 text-sm",
  md: "size-10 text-base",
  post: "size-12 text-lg",
  story: "size-14 text-xl",
  lg: "size-20 text-3xl",
  xl: "size-24 text-4xl",
};

// A 2px ring, then a 2px gap in the tile's colour.
const rings = {
  unseen: "bg-(image:--story-ring)",
  seen: "bg-edge/12",
};

function colorFor(username: string): string {
  let hash = 0;
  for (const char of username) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return colors[hash % colors.length];
}

function initialsFor(displayName: string): string {
  const words = displayName.trim().split(/\s+/);
  const initials = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return initials.join("").toUpperCase();
}

type AvatarProps = {
  user: Pick<User, "username" | "displayName" | "avatarUrl">;
  size?: keyof typeof sizes;
  /** A story ring; whatever it means must also be said in text nearby. */
  ring?: keyof typeof rings;
};

/** Decorative: the user's name is always shown next to it. */
export function Avatar({ user, size = "md", ring }: AvatarProps) {
  // The failed URL, not a flag, so a changed URL is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // A path on the API; nothing else is loaded.
  const url = apiAssetUrl(user.avatarUrl);

  const picture =
    url && url !== failedUrl ? (
      // Plain <img> on purpose: next/image would have the Next.js server fetch it.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(url)}
        className={`shrink-0 rounded-full bg-tile object-cover ${sizes[size]}`}
      />
    ) : (
      <span
        aria-hidden="true"
        className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${sizes[size]} ${colorFor(user.username)}`}
      >
        {initialsFor(user.displayName)}
      </span>
    );

  if (!ring) return picture;

  return (
    <span data-ring={ring} className={`inline-flex shrink-0 rounded-full p-0.5 ${rings[ring]}`}>
      <span className="inline-flex rounded-full bg-tile p-0.5">{picture}</span>
    </span>
  );
}
