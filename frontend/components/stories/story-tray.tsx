"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useCurrentUser } from "@/components/auth/auth-provider";
import { Avatar } from "@/components/ui/avatar";
import { PlusIcon } from "@/components/ui/icons";
import type { StoryGroup } from "@/lib/stories";
import { AddStoryDialog } from "./add-story-dialog";
import { StoryViewer } from "./story-viewer";
import { useStories } from "./use-stories";

function Ring({ state, children }: { state: "new" | "seen" | "none"; children: ReactNode }) {
  const ring = {
    new: "border-[3px] border-accent p-0.5",
    seen: "border-2 border-border p-[3px]",
    none: "p-[5px]",
  };
  return <span className={`block rounded-full ${ring[state]}`}>{children}</span>;
}

function TraySkeleton() {
  return Array.from({ length: 4 }, (_, index) => (
    <li key={index} aria-hidden="true" className="w-18 shrink-0 animate-pulse">
      <span className="mx-auto block size-16.5 rounded-full bg-hover" />
      <span className="mx-auto mt-1.5 block h-2.5 w-12 rounded bg-hover" />
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
    <section aria-label="Stories" className="border-b border-border">
      <ul className="flex items-start gap-3 overflow-x-auto px-4 py-3">
        <li className="w-18 shrink-0">
          <div className="relative mx-auto w-fit">
            {own ? (
              <button
                type="button"
                aria-label="Your story"
                onClick={(event) => open(own, event)}
                className="block rounded-full"
              >
                <Ring state="new">
                  <Avatar user={viewer} size="story" />
                </Ring>
              </button>
            ) : (
              <Ring state="none">
                <Avatar user={viewer} size="story" />
              </Ring>
            )}
            {/* The same button with stories or without, so focus can come back to it. */}
            <button
              ref={addButtonRef}
              type="button"
              aria-label="Add a story"
              onClick={() => setAdding(true)}
              className={`absolute rounded-full ${own ? "-right-0.5 -bottom-0.5" : "inset-0"}`}
            >
              <span
                className={`flex size-6 items-center justify-center rounded-full border-2 border-background bg-accent text-accent-foreground ${
                  own ? "" : "absolute -right-0.5 -bottom-0.5"
                }`}
              >
                <PlusIcon width={14} height={14} strokeWidth={2.5} />
              </span>
            </button>
          </div>
          <p aria-hidden="true" className="mt-1 truncate text-center text-xs">
            Your story
          </p>
        </li>

        {stories.status === "loading" && <TraySkeleton />}

        {stories.status === "error" && (
          <li className="flex shrink-0 items-center gap-2 self-center text-sm">
            <span role="alert" className="text-muted">
              Couldn&apos;t load stories.
            </span>
            <button
              type="button"
              onClick={stories.retry}
              className="rounded-full border border-border px-3 py-1 font-semibold transition-colors hover:bg-hover"
            >
              Try again
            </button>
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
              className="flex w-full flex-col items-center gap-1 rounded-lg"
            >
              <Ring state={group.hasUnviewed ? "new" : "seen"}>
                <Avatar user={group.author} size="story" />
              </Ring>
              <span className="w-full truncate text-center text-xs">
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
