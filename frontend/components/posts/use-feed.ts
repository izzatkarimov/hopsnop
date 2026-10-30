"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import type { PostPage } from "@/lib/posts";
import type { Post } from "@/lib/types";

type LoadPage = (cursor?: string | null) => Promise<PostPage>;

export type FeedState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      posts: Post[];
      nextCursor: string | null;
      loadingMore: boolean;
      loadMoreError: string | null;
    };

export type Feed = {
  state: FeedState;
  posts: Post[];
  retry: () => void;
  loadMore: () => void;
  updatePosts: (change: (posts: Post[]) => Post[]) => void;
  /** Shown even if the first page is on its way; not re-added when a page has it. */
  addPost: (post: Post) => void;
};

const NO_POSTS: Post[] = [];

/** A post already there stays put, so the order stays the backend's. */
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

/** `loadPage` must be the same function on every render. */
export function useFeed(loadPage: LoadPage, enabled: boolean): Feed {
  const { expireSession } = useAuth();
  const [state, setState] = useState<FeedState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // A ref: the state only changes on the next render.
  const loadingMore = useRef(false);
  // Go in front of the first page whenever it arrives.
  const written = useRef<Post[]>([]);

  useEffect(() => {
    if (!enabled) return;
    // Set by the cleanup, so a stale request can't change the state.
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
          // The session is gone, but a public page stays: the feed must fail, not hang.
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
      if (isApiError(error) && error.kind === "unauthenticated") {
        expireSession();
      }
      // The cursor stays, so the same page can be asked for again.
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
