"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useCurrentUser } from "@/components/auth/auth-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@/components/ui/icons";
import type { StoryGroup } from "@/lib/stories";
import { AddStoryDialog } from "./add-story-dialog";
import { StoryViewer } from "./story-viewer";
import { useStories } from "./use-stories";

function TraySkeleton() {
  return Array.from({ length: 4 }, (_, index) => (
    <li
      key={index}
      aria-hidden="true"
      className="flex w-18 shrink-0 flex-col items-center gap-2 motion-safe:animate-pulse"
    >
      <span className="block size-16 rounded-full bg-edge/6" />
      <span className="block h-3 w-12 rounded-full bg-edge/6" />
    </li>
  ));
}

/** Loaded on its own, so the feed goes on whatever happens to it. */
export function StoryTray() {
  const viewer = useCurrentUser();
  const stories = useStories(viewer.username);
  const [adding, setAdding] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef({ viewer: false, adding: false });

  const viewerOpen = stories.viewing !== null;
  useEffect(() => {
    const before = wasOpen.current;
    wasOpen.current = { viewer: viewerOpen, adding };
    if (before.viewer && !viewerOpen) {
      // The opener may be gone, with the last of its author's stories.
      const opener = openerRef.current;
      (opener?.isConnected ? opener : addButtonRef.current)?.focus();
    } else if (before.adding && !adding) {
      addButtonRef.current?.focus();
    }
  }, [viewerOpen, adding]);

  const own = stories.groups.find((group) => group.isOwn);
  const others = stories.groups.filter((group) => !group.isOwn);

  function open(group: StoryGroup, event: MouseEvent<HTMLButtonElement>) {
    openerRef.current = event.currentTarget;
    stories.open(group.author.username);
  }

  return (
    <section aria-label="Stories" className="rounded-tile surface-tile glow-top">
      <ul className="flex items-start gap-3 overflow-x-auto p-4">
        <li className="flex w-18 shrink-0 flex-col items-center gap-2">
          <div className="relative">
            {/* No ring for one's own stories: the badge says what can be done. */}
            {own ? (
              <button
                type="button"
                aria-label="Your story"
                onClick={(event) => open(own, event)}
                className="block rounded-full p-1 focus-ring"
              >
                <Avatar user={viewer} size="story" />
              </button>
            ) : (
              <span className="block p-1">
                <Avatar user={viewer} size="story" />
              </span>
            )}
            {/* The same button with stories or without, so focus can come back to it. */}
            <button
              ref={addButtonRef}
              type="button"
              aria-label="Add a story"
              onClick={() => setAdding(true)}
              className={`absolute rounded-full focus-ring ${own ? "right-0 bottom-0 size-6" : "inset-0"}`}
            >
              <span className="absolute right-0 bottom-0 flex size-6 items-center justify-center rounded-full bg-accent text-white inset-ring-2 inset-ring-tile inset-shadow-[0_1px_0] inset-shadow-highlight/24">
                <IconPlus size={16} />
              </span>
            </button>
          </div>
          <p aria-hidden="true" className="w-full truncate text-center text-meta font-medium text-primary">
            Your story
          </p>
        </li>

        {stories.status === "loading" && <TraySkeleton />}

        {stories.status === "error" && (
          <li className="flex shrink-0 items-center gap-3 self-center">
            <span role="alert" className="text-body text-secondary">
              Couldn&apos;t load stories.
            </span>
            <Button onClick={stories.retry}>Try again</Button>
          </li>
        )}

        {others.map((group) => (
          <li key={group.author.username} className="w-18 shrink-0">
            <button
              type="button"
              aria-label={`Stories by ${group.author.displayName}, ${
                group.hasUnviewed ? "new" : "all seen"
              }`}
              onClick={(event) => open(group, event)}
              className="flex w-full flex-col items-center gap-2 rounded-item focus-ring"
            >
              <Avatar
                user={group.author}
                size="story"
                ring={group.hasUnviewed ? "unseen" : "seen"}
              />
              <span
                className={`w-full truncate text-center text-meta ${
                  group.hasUnviewed ? "font-medium text-primary" : "text-muted"
                }`}
              >
                {group.author.displayName}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p role="status" className="sr-only">
        {stories.status === "loading"
          ? "Loading stories…"
          : viewerOpen
            ? ""
            : stories.announcement}
      </p>

      {stories.viewing && (
        <StoryViewer
          {...stories.viewing}
          step={stories.step}
          announcement={stories.announcement}
          onNext={stories.next}
          onPrevious={stories.previous}
          onClose={stories.close}
          onSeen={stories.recordView}
          onDelete={stories.deleteStory}
          onPictureError={stories.checkStory}
        />
      )}

      {adding && (
        <AddStoryDialog
          onPublished={(story) => {
            stories.add(story);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}
