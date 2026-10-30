"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import { profileHref } from "@/components/posts/post-item";
import { Avatar } from "@/components/ui/avatar";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { apiAssetUrl } from "@/lib/api";
import { formatCount, formatFullDate, formatRelativeTime } from "@/lib/format";
import type { Story } from "@/lib/types";
import { useReducedMotion } from "./use-reduced-motion";
import type { Viewing } from "./use-stories";

export const STORY_DURATION_MS = 5000;

/** A press this long only paused it: letting go doesn't move on. */
const LONG_PRESS_MS = 500;

type StoryViewerProps = Viewing & {
  /** Changes with every move, also to the same story, which restarts it. */
  step: number;
  announcement: string;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  /** Called when the picture has loaded, which is when it has been seen. */
  onSeen: (story: Story) => void;
  /** Resolves with why it couldn't be deleted, or null once it's gone. */
  onDelete: (story: Story) => Promise<string | null>;
  /** Resolves with whether the story is still there. */
  onPictureError: (story: Story) => Promise<boolean>;
};

const buttonClass =
  "inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-hover disabled:opacity-50";

export function StoryViewer({
  group,
  story,
  step,
  announcement,
  onNext,
  onPrevious,
  onClose,
  onSeen,
  onDelete,
  onPictureError,
}: StoryViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  // By story id, so nothing carries over to the next one.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [brokenId, setBrokenId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const lastInput = useRef<"keyboard" | "pointer">("pointer");
  const pressedAt = useRef(0);
  const deleteInFlight = useRef(false);
  const remaining = useRef(STORY_DURATION_MS);

  const { author } = story;
  const position = group.stories.findIndex((item) => item.id === story.id);
  const loaded = loadedId === story.id;
  const broken = brokenId === story.id;
  const confirming = confirmingId === story.id;
  const running = loaded && !reducedMotion && !pressed && !keyboardFocus && !confirming;
  const playKey = `${story.id}:${step}`;
  const url = apiAssetUrl(story.mediaUrl);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // The dialog itself, so no control has focus until the user moves it.
    dialog.focus();
  }, []);

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
    if (event.key === "Escape") {
      // Handled here so it works the same in every browser.
      event.preventDefault();
      if (confirming) {
        cancelDelete();
      } else {
        onClose();
      }
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onNext();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onPrevious();
    }
  }

  function handleFocus(event: FocusEvent<HTMLDialogElement>) {
    // Paused only for focus the keyboard moved there, not a click.
    const onControl =
      event.target !== event.currentTarget && event.target.matches("a, button");
    setKeyboardFocus(onControl && lastInput.current === "keyboard");
  }

  function handleBlur(event: FocusEvent<HTMLDialogElement>) {
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

  function cancelDelete() {
    setConfirmingId(null);
    setDeleteError(null);
    deleteButtonRef.current?.focus();
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
    <dialog
      ref={dialogRef}
      aria-label={group.isOwn ? "Your story" : `Stories by ${author.displayName}`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onPointerDown={() => {
        lastInput.current = "pointer";
      }}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-background p-0 text-foreground outline-none backdrop:bg-black/80 sm:m-auto sm:h-[min(90dvh,52rem)] sm:max-w-md sm:rounded-2xl sm:border sm:border-border"
    >
      <div className="flex h-full flex-col">
        <div aria-hidden="true" className="flex gap-1 px-3 pt-3">
          {group.stories.map((item, index) => (
            <span
              key={item.id}
              className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/20"
            >
              {(index < position || (index === position && reducedMotion)) && (
                <span className="block h-full w-full bg-foreground" />
              )}
              {index === position && !reducedMotion && loaded && (
                <span
                  key={playKey}
                  className={`block h-full w-full origin-left animate-story-progress bg-foreground ${
                    running ? "" : "[animation-play-state:paused]"
                  }`}
                />
              )}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 py-2">
          <Link
            href={profileHref(author.username)}
            className="flex min-w-0 items-center gap-2 rounded-full"
          >
            <Avatar user={author} size="sm" />
            <span className="truncate font-semibold">{author.displayName}</span>
          </Link>
          <time
            dateTime={story.createdAt}
            title={formatFullDate(story.createdAt)}
            className="shrink-0 text-sm text-muted"
          >
            {formatRelativeTime(story.createdAt)}
          </time>
          <span className="sr-only">
            Story {position + 1} of {group.stories.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto shrink-0 rounded-full p-2 transition-colors hover:bg-hover"
          >
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
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
              className="block h-auto max-h-full w-full object-contain"
            />
          ) : (
            <p className="px-6 text-center text-sm text-white">
              This picture couldn&apos;t be loaded.
            </p>
          )}
          {/* For pointers only: the buttons below do the same for everyone. */}
          <div
            aria-hidden="true"
            data-testid="story-previous-area"
            onPointerDown={press}
            onPointerUp={release}
            onPointerCancel={release}
            onPointerLeave={release}
            onClick={tap(onPrevious)}
            className="absolute inset-y-0 left-0 w-1/2 select-none"
          />
          <div
            aria-hidden="true"
            data-testid="story-next-area"
            onPointerDown={press}
            onPointerUp={release}
            onPointerCancel={release}
            onPointerLeave={release}
            onClick={tap(onNext)}
            className="absolute inset-y-0 right-0 w-1/2 select-none"
          />
        </div>

        {story.caption && (
          <p className="px-4 pt-3 text-body whitespace-pre-wrap wrap-break-word">
            {story.caption}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 px-3 py-3">
          <button type="button" onClick={onPrevious} className={buttonClass}>
            <ChevronLeftIcon width={16} height={16} />
            Previous
          </button>
          {group.isOwn && story.viewCount !== null && (
            <span className="text-sm text-muted">Seen by {formatCount(story.viewCount)}</span>
          )}
          {group.isOwn && (
            <button
              ref={deleteButtonRef}
              type="button"
              onClick={() => {
                setDeleteError(null);
                setConfirmingId(story.id);
              }}
              className={`${buttonClass} text-danger`}
            >
              <TrashIcon width={16} height={16} />
              Delete
            </button>
          )}
          <button type="button" onClick={onNext} className={`${buttonClass} ml-auto`}>
            Next
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>

        {confirming && (
          <div
            role="group"
            aria-label="Delete story"
            className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3 py-3"
          >
            <p className="mr-auto text-sm">Delete this story? This can&apos;t be undone.</p>
            <button
              type="button"
              autoFocus
              onClick={cancelDelete}
              disabled={deleting}
              className={buttonClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="rounded-full border border-danger/40 px-3 py-1.5 text-sm font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}
        {deleteError?.id === story.id && (
          <p role="alert" className="px-3 pb-3 text-sm text-danger">
            {deleteError.message}
          </p>
        )}

        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
    </dialog>
  );
}
