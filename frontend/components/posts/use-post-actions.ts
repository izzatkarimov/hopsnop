"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import * as postsApi from "@/lib/posts";
import type { Post } from "@/lib/types";

/**
 * Somewhere posts are shown: a feed, a list of replies, the one post of a
 * post page. A post can be in several of them at once.
 */
export type PostContainer = {
  posts: Post[];
  updatePosts: (change: (posts: Post[]) => Post[]) => void;
};

/** How an attempt to save an edit ended. */
export type EditResult =
  | { saved: true }
  | {
      saved: false;
      /** Whether the editor has nothing more to offer and should close. */
      close: boolean;
      /** What to tell the user, when the editor stays open. */
      message: string;
    };

/** What a post needs in order to be acted on. See usePostActions. */
export type PostHandlers = {
  /** The signed-in user's id, or null for a visitor without a session. */
  viewerId: string | null;
  /** Why the last action on a post failed, by post id. */
  actionErrors: Record<string, string>;
  /** Whether editing the post should be offered to its author. */
  canEdit: (post: Post) => boolean;
  onToggleLike: (postId: string) => void;
  onToggleRepost: (postId: string) => void;
  onEdit: (postId: string, content: string) => Promise<EditResult>;
  /** Resolves with why the post could not be deleted, or null if it is gone. */
  onDelete: (postId: string) => Promise<string | null>;
};

export type PostActions = {
  handlers: PostHandlers;
  /** What happened to a post that is no longer shown, if anything did. */
  notice: string | null;
};

const GONE = "This post is no longer available.";

/** What to tell the user when a like or a repost was not accepted. */
function interactionErrorMessage(kind: "like" | "repost", error: unknown) {
  if (isApiError(error) && error.kind === "forbidden") {
    return `You're not allowed to ${kind} this post.`;
  }
  return unexpectedErrorMessage(error);
}

/**
 * Liking, reposting, editing and deleting, for every post in `containers`.
 *
 * All four go to the API, and what is shown afterwards is what the API
 * answered. A change to a post is applied wherever that post is in
 * `containers`, and a post that turns out not to exist any more is taken
 * out of all of them.
 */
export function usePostActions(containers: PostContainer[]): PostActions {
  const auth = useAuth();
  const { expireSession } = auth;
  const viewerId = auth.status === "authenticated" ? auth.user.id : null;

  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  // Posts the backend has refused to edit for being too old. This device's
  // clock may still think otherwise; the backend's is the one that counts.
  const [editClosed, setEditClosed] = useState<ReadonlySet<string>>(new Set());
  // The requests that are on their way, as "like:<post id>". A ref, because
  // it changes at once: a second click can arrive before React has rendered
  // the first.
  const inFlight = useRef(new Set<string>());

  function findPost(postId: string): Post | undefined {
    for (const container of containers) {
      const post = container.posts.find((post) => post.id === postId);
      if (post) return post;
    }
  }

  function updatePost(postId: string, change: (post: Post) => Post) {
    for (const container of containers) {
      container.updatePosts((posts) =>
        posts.map((post) => (post.id === postId ? change(post) : post)),
      );
    }
  }

  function removePost(postId: string, why: string) {
    for (const container of containers) {
      container.updatePosts((posts) =>
        posts.filter((post) => post.id !== postId),
      );
    }
    setActionError(postId, null);
    setNotice(why);
  }

  function setActionError(postId: string, message: string | null) {
    setActionErrors((current) => {
      const next = { ...current };
      if (message === null) delete next[postId];
      else next[postId] = message;
      return next;
    });
  }

  function isUnauthenticated(error: unknown): boolean {
    return isApiError(error) && error.kind === "unauthenticated";
  }

  function isNotFound(error: unknown): boolean {
    return isApiError(error) && error.kind === "not_found";
  }

  /**
   * Likes or reposts a post, or takes that back. The change is shown at
   * once and then replaced by what the backend answered; if the backend
   * refuses, what was shown before is put back.
   *
   * One request per post and kind at a time: until it is answered, further
   * clicks on the same control do nothing, so no answer can arrive after a
   * newer action.
   */
  async function toggle(
    kind: "like" | "repost",
    postId: string,
    read: (post: Post) => { active: boolean; count: number },
    write: (active: boolean, count: number) => Partial<Post>,
    send: (active: boolean) => Promise<{ active: boolean; count: number }>,
  ) {
    const key = `${kind}:${postId}`;
    const post = findPost(postId);
    if (!post || inFlight.current.has(key)) return;

    const before = read(post);
    const wanted = !before.active;
    const show = (active: boolean, count: number) =>
      updatePost(postId, (current) => ({ ...current, ...write(active, count) }));

    inFlight.current.add(key);
    setActionError(postId, null);
    setNotice(null);
    show(wanted, Math.max(0, before.count + (wanted ? 1 : -1)));
    try {
      const after = await send(wanted);
      show(after.active, after.count);
    } catch (error) {
      show(before.active, before.count);
      if (isUnauthenticated(error)) {
        // The session is gone. RequireAuth leads to the login page; a
        // public page goes on as for a signed-out visitor.
        expireSession();
      } else if (isNotFound(error)) {
        // Deleted since it was loaded: there is nothing left to show.
        removePost(postId, "A post was removed because it is no longer available.");
      } else {
        setActionError(postId, interactionErrorMessage(kind, error));
      }
    } finally {
      inFlight.current.delete(key);
    }
  }

  function onToggleLike(postId: string) {
    void toggle(
      "like",
      postId,
      (post) => ({ active: post.likedByViewer, count: post.likeCount }),
      (likedByViewer, likeCount) => ({ likedByViewer, likeCount }),
      async (liked) => {
        const state = await postsApi.setLike(postId, liked);
        return { active: state.liked, count: state.likeCount };
      },
    );
  }

  function onToggleRepost(postId: string) {
    void toggle(
      "repost",
      postId,
      (post) => ({ active: post.repostedByViewer, count: post.repostCount }),
      (repostedByViewer, repostCount) => ({ repostedByViewer, repostCount }),
      async (reposted) => {
        const state = await postsApi.setRepost(postId, reposted);
        return { active: state.reposted, count: state.repostCount };
      },
    );
  }

  async function onEdit(postId: string, content: string): Promise<EditResult> {
    const key = `edit:${postId}`;
    if (inFlight.current.has(key)) {
      return { saved: false, close: false, message: "" };
    }

    inFlight.current.add(key);
    setActionError(postId, null);
    setNotice(null);
    try {
      const saved = await postsApi.updatePost(postId, content);
      // The whole post as the backend has it now, not only the text.
      updatePost(postId, () => saved);
      return { saved: true };
    } catch (error) {
      if (isUnauthenticated(error)) {
        expireSession();
        return { saved: false, close: true, message: "" };
      }
      if (isNotFound(error)) {
        removePost(postId, "A post was removed because it is no longer available.");
        return { saved: false, close: true, message: "" };
      }
      if (isApiError(error) && error.kind === "conflict") {
        // Too old to be edited. The text shown stays the published one.
        setEditClosed((current) => new Set(current).add(postId));
        setActionError(
          postId,
          `A post can only be edited for ${postsApi.POST_EDIT_WINDOW_MINUTES} minutes after it was published.`,
        );
        return { saved: false, close: true, message: "" };
      }
      if (isApiError(error) && error.kind === "forbidden") {
        setActionError(postId, "You're not allowed to edit this post.");
        return { saved: false, close: true, message: "" };
      }
      return {
        saved: false,
        close: false,
        message:
          isApiError(error) && error.kind === "validation"
            ? (error.fieldErrors.content ??
              "This text wasn't accepted. Check it and try again.")
            : unexpectedErrorMessage(error),
      };
    } finally {
      inFlight.current.delete(key);
    }
  }

  async function onDelete(postId: string): Promise<string | null> {
    const key = `delete:${postId}`;
    if (inFlight.current.has(key)) return null;

    inFlight.current.add(key);
    setActionError(postId, null);
    setNotice(null);
    try {
      await postsApi.deletePost(postId);
      removePost(postId, "Your post was deleted.");
      return null;
    } catch (error) {
      if (isUnauthenticated(error)) {
        expireSession();
        return null;
      }
      if (isNotFound(error)) {
        // Already gone, which is what was asked for.
        removePost(postId, GONE);
        return null;
      }
      return isApiError(error) && error.kind === "forbidden"
        ? "You're not allowed to delete this post."
        : unexpectedErrorMessage(error);
    } finally {
      inFlight.current.delete(key);
    }
  }

  function canEdit(post: Post): boolean {
    return (
      post.author.id === viewerId &&
      !editClosed.has(post.id) &&
      postsApi.isWithinEditWindow(post)
    );
  }

  return {
    handlers: {
      viewerId,
      actionErrors,
      canEdit,
      onToggleLike,
      onToggleRepost,
      onEdit,
      onDelete,
    },
    notice,
  };
}
