"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import type { PostPage } from "@/lib/posts";
import type { Post } from "@/lib/types";

/** Loads one page of a feed; see lib/feed.ts. */
type LoadPage = (cursor?: string | null) => Promise<PostPage>;

export type FeedState =
  /** The first page is being loaded, or has not been asked for yet. */
  | { status: "loading" }
  /** The first page could not be loaded. Nothing is shown in its place. */
  | { status: "error"; message: string }
  | {
      status: "ready";
      /** In the order the backend returned them, page after page. */
      posts: Post[];
      /** Where the next page starts, or null if everything is loaded. */
      nextCursor: string | null;
      loadingMore: boolean;
      /** Why the last attempt to load another page failed, if it did. */
      loadMoreError: string | null;
    };

export type Feed = {
  state: FeedState;
  /** The posts that are loaded; none until the first page has arrived. */
  posts: Post[];
  /** Loads the first page again after it failed. */
  retry: () => void;
  /** Loads the page after the ones already shown. */
  loadMore: () => void;
  /** Applies a change to the posts that are loaded. */
  updatePosts: (change: (posts: Post[]) => Post[]) => void;
  /**
   * Puts a post that was just written at the top. It is shown as soon as
   * there is a list to show it in, also if the first page is still on its
   * way, and it is not added again when a page that has it arrives.
   */
  addPost: (post: Post) => void;
};

const NO_POSTS: Post[] = [];

/**
 * Adds a page to the posts already loaded. A post that is already there is
 * left where it is and not added a second time, so the order stays the
 * backend's.
 */
function appendPage(posts: Post[], page: Post[]): Post[] {
  const known = new Set(posts.map((post) => post.id));
  const added: Post[] = [];
  for (const post of page) {
    if (known.has(post.id)) continue;
    known.add(post.id);
    added.push(post);
  }
  return [...posts, ...added];
}

/**
 * One feed and the pages of it that have been loaded.
 *
 * Nothing is requested until `enabled` is true, which is how a tab that was
 * never opened costs no request. After that the state is kept for as long as
 * the component using this is mounted, whichever feed is on screen: every
 * feed has a state of its own, so an answer can only ever arrive in the feed
 * that asked for it.
 *
 * `loadPage` must be the same function on every render.
 */
export function useFeed(loadPage: LoadPage, enabled: boolean): Feed {
  const { expireSession } = useAuth();
  const [state, setState] = useState<FeedState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Guards against asking for the same page twice. A ref, because it changes
  // at once: the state only changes when React next renders.
  const loadingMore = useRef(false);
  // The posts written here, newest first. They go in front of the first
  // page whenever it arrives, however long that takes.
  const written = useRef<Post[]>([]);

  useEffect(() => {
    if (!enabled) return;
    // Set by the cleanup, so that a request this effect no longer cares
    // about (the page was left, or a retry started) cannot change the state.
    let ignore = false;

    loadPage().then(
      (page) => {
        if (ignore) return;
        setState({
          status: "ready",
          posts: appendPage(written.current, page.posts),
          nextCursor: page.nextCursor,
          loadingMore: false,
          loadMoreError: null,
        });
      },
      (error: unknown) => {
        if (ignore) return;
        if (isApiError(error) && error.kind === "unauthenticated") {
          // The session is gone. RequireAuth leads to the login page, but a
          // public page stays where it is, so the feed must not be left
          // waiting: it fails like any other request.
          expireSession();
        }
        setState({ status: "error", message: unexpectedErrorMessage(error) });
      },
    );

    return () => {
      ignore = true;
    };
  }, [enabled, attempt, loadPage, expireSession]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  async function loadMore() {
    if (loadingMore.current) return;
    if (state.status !== "ready" || state.nextCursor === null) return;

    loadingMore.current = true;
    setState((current) =>
      current.status === "ready"
        ? { ...current, loadingMore: true, loadMoreError: null }
        : current,
    );

    try {
      const page = await loadPage(state.nextCursor);
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              posts: appendPage(current.posts, page.posts),
              nextCursor: page.nextCursor,
              loadingMore: false,
              loadMoreError: null,
            }
          : current,
      );
    } catch (error) {
      // As for the first page: the session is ended, and the feed still
      // says that this page could not be loaded.
      if (isApiError(error) && error.kind === "unauthenticated") {
        expireSession();
      }
      // The posts already shown stay, and so does the cursor: the same page
      // can be asked for again.
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              loadingMore: false,
              loadMoreError: unexpectedErrorMessage(error),
            }
          : current,
      );
    } finally {
      loadingMore.current = false;
    }
  }

  function updatePosts(change: (posts: Post[]) => Post[]) {
    written.current = change(written.current);
    setState((current) =>
      current.status === "ready"
        ? { ...current, posts: change(current.posts) }
        : current,
    );
  }

  function addPost(post: Post) {
    updatePosts((posts) =>
      posts.some((existing) => existing.id === post.id)
        ? posts
        : [post, ...posts],
    );
  }

  return {
    state,
    posts: state.status === "ready" ? state.posts : NO_POSTS,
    retry,
    loadMore,
    updatePosts,
    addPost,
  };
}
