"use client";

import { useEffect, useId, useRef, useState } from "react";
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
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
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

export function PostMenu({ post, isOwnPost, onEdit, onDelete, onStatus }: PostMenuProps) {
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";
  const { username } = post.author;
  const [open, setOpen] = useState(false);
  // Known only once asked for; left out until then, or if the answer never comes.
  const [following, setFollowing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

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

  async function copy(text: string, done: string, what: string) {
    close(true);
    onStatus(
      (await copyToClipboard(text))
        ? done
        : `Couldn't copy the ${what}: this browser didn't allow it.`,
    );
  }

  async function unfollow() {
    close(true);
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
        <Menu
          id={menuId}
          label="Post options"
          onClose={close}
          containerRef={containerRef}
          className="absolute top-full right-0 mt-1"
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
          {(onEdit || onDelete) && <MenuSeparator />}
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
        </Menu>
      )}
    </div>
  );
}
