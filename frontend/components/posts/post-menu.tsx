"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { IconButton } from "@/components/ui/icon-button";
import {
  IconCopy,
  IconLink,
  IconMore,
  IconPencil,
  IconPerson,
  IconTrash,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";
import { isApiError } from "@/lib/api";
import { getFollowStatus, setFollow } from "@/lib/profiles";
import type { Post } from "@/lib/types";
import { copyToClipboard, postUrl } from "./links";

type PostMenuProps = {
  post: Post;
  isOwnPost: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  /** A short line under the post: what an item did, or why it couldn't. */
  onStatus: (message: string) => void;
};

/* Full class names are listed so Tailwind can detect them. */
const itemClass =
  "flex w-full items-center gap-3 rounded-item px-3 py-2 text-left text-body font-medium outline-hidden hover:bg-edge/6 focus-visible:bg-edge/6 focus-visible:inset-ring focus-visible:inset-ring-ink/72";

type MenuItemProps = {
  icon: ComponentType<IconProps>;
  label: string;
  danger?: boolean;
  onSelect: () => void;
};

function MenuItem({ icon: Icon, label, danger, onSelect }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`${itemClass} ${danger ? "text-danger" : "text-primary"}`}
    >
      <Icon className="shrink-0" />
      {label}
    </button>
  );
}

export function PostMenu({ post, isOwnPost, onEdit, onDelete, onStatus }: PostMenuProps) {
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";
  const { username } = post.author;
  const [open, setOpen] = useState(false);
  // Known only once asked for; left out until then, or if the answer never comes.
  const [following, setFollowing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function getItems(): HTMLButtonElement[] {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
  }

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !signedIn || isOwnPost) return;
    let ignore = false;
    getFollowStatus(username).then(
      (answer) => {
        if (!ignore) setFollowing(answer);
      },
      () => {
        if (!ignore) setFollowing(false);
      },
    );
    return () => {
      ignore = true;
    };
  }, [open, signedIn, isOwnPost, username]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = getItems();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close({ restoreFocus: true });
        break;
      case "Tab":
        setOpen(false);
        break;
      case "ArrowDown":
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
    }
  }

  async function copy(text: string, done: string, what: string) {
    close({ restoreFocus: true });
    onStatus(
      (await copyToClipboard(text))
        ? done
        : `Couldn't copy the ${what}: this browser didn't allow it.`,
    );
  }

  async function unfollow() {
    close({ restoreFocus: true });
    try {
      setFollowing(await setFollow(username, false));
      onStatus(`You unfollowed @${username}.`);
    } catch (error) {
      if (isApiError(error) && error.kind === "unauthenticated") {
        auth.expireSession();
        return;
      }
      onStatus(
        isApiError(error) && error.kind === "not_found"
          ? "This account is no longer available."
          : `Couldn't unfollow @${username}. Please try again.`,
      );
    }
  }

  function select(action?: () => void) {
    setOpen(false);
    action?.();
  }

  const showUnfollow = open && signedIn && !isOwnPost && following;

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        ref={triggerRef}
        label="More options"
        icon={<IconMore />}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            setFollowing(false);
            setOpen(true);
          }
        }}
        className="-my-1.5 -mr-1.5"
      />

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Post options"
          onKeyDown={handleMenuKeyDown}
          className="absolute top-full right-0 z-30 mt-1 flex w-64 flex-col rounded-popover p-2 surface-popover"
        >
          <MenuItem
            icon={IconLink}
            label="Copy link"
            onSelect={() => copy(postUrl(post.id), "Link copied.", "link")}
          />
          <MenuItem
            icon={IconCopy}
            label="Copy text"
            onSelect={() => copy(post.content, "Text copied.", "text")}
          />
          {showUnfollow && (
            <MenuItem icon={IconPerson} label={`Unfollow @${username}`} onSelect={unfollow} />
          )}
          {(onEdit || onDelete) && (
            <div role="separator" className="mx-2 my-1 h-px bg-edge/6" />
          )}
          {onEdit && (
            <MenuItem icon={IconPencil} label="Edit post" onSelect={() => select(onEdit)} />
          )}
          {onDelete && (
            <MenuItem
              icon={IconTrash}
              label="Delete post"
              danger
              onSelect={() => select(onDelete)}
            />
          )}
        </div>
      )}
    </div>
  );
}
