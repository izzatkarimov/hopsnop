"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import { profileHref } from "@/components/posts/links";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import {
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconEye,
  IconMore,
  IconPause,
  IconTrash,
} from "@/components/ui/icons";
import { Menu, MenuItem } from "@/components/ui/menu";
import { apiAssetUrl } from "@/lib/api";
import { formatCount, formatFullDate, formatRelativeTime } from "@/lib/format";
import type { Story } from "@/lib/types";
import { useReducedMotion } from "./use-reduced-motion";
import type { Neighbours, Viewing } from "./use-stories";

export const STORY_DURATION_MS = 5000;

/** A press this long only paused it: letting go doesn't move on. */
const LONG_PRESS_MS = 500;

/* Full class names are listed so Tailwind can detect them. */

// The whole screen on phones; from 640px 9:16, at most 432×768, smaller on short screens.
const cardClass =
  "relative h-full w-full overflow-clip bg-black sm:aspect-9/16 sm:h-[min(48rem,calc(100dvh-4rem))] sm:w-auto sm:shrink-0 sm:rounded-tile sm:shadow-story";

// Half the card, from 1100px.
const neighbourClass = "hidden aspect-9/16 h-[min(24rem,calc(50dvh-2rem))] shrink-0 wide:block";

// On the card's edges on phones, beside it from 640px.
const stepButtonClass = "absolute top-1/2 z-20 -translate-y-1/2 sm:static sm:size-10 sm:translate-y-0";

type StoryViewerProps = Viewing & {
  neighbours: Neighbours;
  /** Changes with every move, also to the same story, which restarts it. */
  step: number;
  announcement: string;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  /** Opens another author's stories at the one they start from. */
  onOpen: (username: string) => void;
  /** Called when the picture has loaded, which is when it has been seen. */
  onSeen: (story: Story) => void;
  /** Resolves with why it couldn't be deleted, or null once it's gone. */
  onDelete: (story: Story) => Promise<string | null>;
  /** Resolves with whether the story is still there. */
  onPictureError: (story: Story) => Promise<boolean>;
};

export function StoryViewer({
  group,
  story,
  neighbours,
  step,
  announcement,
  onNext,
  onPrevious,
  onClose,
  onOpen,
  onSeen,
  onDelete,
  onPictureError,
}: StoryViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  // By story id, so nothing carries over to the next one.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [brokenId, setBrokenId] = useState<string | null>(null);
  const [menuForId, setMenuForId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Held from one story to the next, until it's pressed again.
  const [paused, setPaused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const lastInput = useRef<"keyboard" | "pointer">("pointer");
  const pressedAt = useRef(0);
  const deleteInFlight = useRef(false);
  const remaining = useRef(STORY_DURATION_MS);
  const menuId = useId();
  const confirmId = useId();

  const { author } = story;
  const position = group.stories.findIndex((item) => item.id === story.id);
  const loaded = loadedId === story.id;
  const broken = brokenId === story.id;
  const menuOpen = menuForId === story.id;
  const confirming = confirmingId === story.id;
  const running =
    loaded && !reducedMotion && !paused && !pressed && !keyboardFocus && !menuOpen && !confirming;
  const playKey = `${story.id}:${step}`;
  const url = apiAssetUrl(story.mediaUrl);

  // A control gone with its story leaves no focus behind.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
  }, [story.id]);

  const advance = useEffectEvent(() => onNext());

  useEffect(() => {
    remaining.current = STORY_DURATION_MS;
  }, [playKey]);

  // The time left is kept while paused.
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setTimeout(advance, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [running, playKey]);

  function handleLoad() {
    setLoadedId(story.id);
    onSeen(story);
  }

  async function handleError() {
    const failed = story;
    if (await onPictureError(failed)) setBrokenId(failed.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    lastInput.current = "keyboard";
    // The menu and the question keep their own keys.
    if (menuOpen || confirming) return;

    if (event.key === "ArrowRight") {
      event.preventDefault();
      onNext();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onPrevious();
    } else if (event.key === " " && !reducedMotion) {
      // On a link or a button, Space is theirs.
      if (event.target instanceof Element && event.target.closest("a, button")) return;
      event.preventDefault();
      setPaused((value) => !value);
    }
  }

  function handleDismiss() {
    if (confirming) cancelDelete();
    else onClose();
  }

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    // Paused only for focus the keyboard moved there, not a click.
    setKeyboardFocus(event.target.matches("a, button") && lastInput.current === "keyboard");
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
  }

  function press() {
    pressedAt.current = Date.now();
    setPressed(true);
  }

  function release() {
    setPressed(false);
  }

  function tap(move: () => void) {
    return () => {
      const held = pressedAt.current ? Date.now() - pressedAt.current : 0;
      pressedAt.current = 0;
      if (held < LONG_PRESS_MS) move();
    };
  }

  function closeMenu(restoreFocus: boolean) {
    setMenuForId(null);
    if (restoreFocus) menuButtonRef.current?.focus();
  }

  function askToDelete() {
    setMenuForId(null);
    setDeleteError(null);
    setConfirmingId(story.id);
  }

  function cancelDelete() {
    setConfirmingId(null);
    setDeleteError(null);
    menuButtonRef.current?.focus();
  }

  async function confirmDelete() {
    if (deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleting(true);
    setDeleteError(null);
    // Resolves with null once the story is gone and the viewer has moved on.
    const error = await onDelete(story);
    deleteInFlight.current = false;
    setDeleting(false);
    if (error) setDeleteError({ id: story.id, message: error });
  }

  return (
    <Dialog
      ref={dialogRef}
      variant="fullscreen"
      title={group.isOwn ? "Your story" : `Stories by ${author.displayName}`}
      onClose={handleDismiss}
      onKeyDown={handleKeyDown}
    >
      <div
        onPointerDown={() => {
          lastInput.current = "pointer";
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="relative flex size-full items-center justify-center sm:gap-6"
      >
        <Neighbour side="previous" viewing={neighbours.previous} onOpen={onOpen} />
        <IconButton
          label="Previous"
          icon={<IconChevronLeft />}
          variant="secondary"
          size="sm"
          onClick={onPrevious}
          className={`left-2 ${stepButtonClass}`}
        />

        <div className={cardClass}>
          {url && !broken ? (
            // A plain <img>: the browser loads it from the API, with the cookie.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={story.id}
              src={url}
              alt={`Story by ${author.displayName}`}
              width={story.mediaWidth}
              height={story.mediaHeight}
              referrerPolicy="no-referrer"
              decoding="async"
              draggable={false}
              onLoad={handleLoad}
              onError={handleError}
              className="absolute inset-0 size-full object-contain"
            />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-body text-white/72">
              This picture couldn&apos;t be loaded.
            </p>
          )}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-linear-to-b from-black/56 to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-50 bg-linear-to-t from-black/64 to-transparent"
          />

          {/* For pointers only: Previous, Next and Pause do the same for everyone. */}
          <div
            aria-hidden="true"
            onPointerDown={press}
            onPointerUp={release}
            onPointerCancel={release}
            onPointerLeave={release}
            className="absolute inset-0 flex select-none"
          >
            <div data-testid="story-previous-area" onClick={tap(onPrevious)} className="w-1/3" />
            <div className="flex-1" />
            <div data-testid="story-next-area" onClick={tap(onNext)} className="w-1/3" />
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-3 p-4">
            <div aria-hidden="true" className="flex gap-2">
              {group.stories.map((item, index) => (
                <span key={item.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/32">
                  {(index < position || (index === position && reducedMotion)) && (
                    <span className="block size-full bg-white" />
                  )}
                  {index === position && !reducedMotion && loaded && (
                    <span
                      key={playKey}
                      className={`block size-full origin-left animate-story-progress bg-white ${
                        running ? "" : "[animation-play-state:paused]"
                      }`}
                    />
                  )}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 pr-10 sm:pr-0">
              <Link
                href={profileHref(author.username)}
                className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full focus-ring"
              >
                <Avatar user={author} size="compact" />
                <span className="truncate text-body font-semibold">{author.displayName}</span>
              </Link>
              <time
                dateTime={story.createdAt}
                title={formatFullDate(story.createdAt)}
                className="shrink-0 text-body text-white/72"
              >
                {formatRelativeTime(story.createdAt)}
              </time>
              <span className="sr-only">
                Story {position + 1} of {group.stories.length}
              </span>
              <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1">
                {/* Nothing moves by itself with reduced motion, so there's nothing to pause. */}
                {!reducedMotion && (
                  <IconButton
                    label="Pause"
                    aria-pressed={paused}
                    icon={<IconPause />}
                    variant="overlay"
                    size="sm"
                    onClick={() => setPaused((value) => !value)}
                  />
                )}
                {group.isOwn && (
                  <div ref={menuContainerRef} className="relative">
                    <IconButton
                      ref={menuButtonRef}
                      label="Story options"
                      icon={<IconMore />}
                      variant="overlay"
                      size="sm"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      aria-controls={menuOpen ? menuId : undefined}
                      onClick={() => setMenuForId(menuOpen ? null : story.id)}
                    />
                    {menuOpen && (
                      <Menu
                        id={menuId}
                        label="Story options"
                        onClose={closeMenu}
                        containerRef={menuContainerRef}
                        className="absolute top-full right-0 mt-1"
                      >
                        <MenuItem icon={IconTrash} label="Delete story" danger onSelect={askToDelete} />
                      </Menu>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {(story.caption || (group.isOwn && story.viewCount !== null)) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4">
              {story.caption && (
                <p className="text-body whitespace-pre-wrap wrap-break-word">{story.caption}</p>
              )}
              {group.isOwn && story.viewCount !== null && (
                <p className="flex items-center gap-1 text-meta font-medium text-white/72">
                  <IconEye size={16} />
                  Seen by {formatCount(story.viewCount)}
                </p>
              )}
            </div>
          )}

          {confirming && (
            <div
              role="group"
              aria-labelledby={confirmId}
              className="absolute inset-x-3 bottom-3 z-20 flex flex-col gap-4 rounded-tile p-4 text-primary surface-popover"
            >
              <div className="flex flex-col gap-1">
                <p id={confirmId} className="text-body font-semibold">
                  Delete this story?
                </p>
                <p className="text-body text-secondary">This can&apos;t be undone.</p>
              </div>
              {deleteError?.id === story.id && (
                <p role="alert" className="text-meta font-medium text-danger">
                  {deleteError.message}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button autoFocus onClick={cancelDelete} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <IconButton
          label="Next"
          icon={<IconChevronRight />}
          variant="secondary"
          size="sm"
          onClick={onNext}
          className={`right-2 ${stepButtonClass}`}
        />
        <Neighbour side="next" viewing={neighbours.next} onOpen={onOpen} />

        <IconButton
          label="Close"
          icon={<IconClose />}
          variant="overlay"
          size="sm"
          onClick={onClose}
          className="absolute top-8 right-4 z-30 sm:top-6 sm:right-6 sm:size-10"
        />

        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
    </Dialog>
  );
}

type NeighbourProps = {
  side: "previous" | "next";
  viewing: Viewing | null;
  onOpen: (username: string) => void;
};

/** Pointer only, never focused and hidden from screen readers: Next and Previous reach the same authors. */
function Neighbour({ side, viewing, onOpen }: NeighbourProps) {
  if (!viewing) return <div aria-hidden="true" className={neighbourClass} />;

  const { group, story } = viewing;
  const url = apiAssetUrl(story.mediaUrl);

  return (
    <div
      aria-hidden="true"
      data-testid={`story-${side}-author`}
      onClick={() => onOpen(group.author.username)}
      className={`relative cursor-pointer overflow-clip rounded-field bg-black ${neighbourClass}`}
    >
      {url && (
        // No onLoad: showing a picture here records no view.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full object-contain"
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/48 p-4 text-center">
        <Avatar user={group.author} size="story" ring={group.hasUnviewed ? "unseen" : "seen"} />
        <div className="flex w-full flex-col">
          <p className="truncate text-body font-semibold">{group.author.displayName}</p>
          <p className="text-meta font-medium text-white/72">
            {formatRelativeTime(story.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
