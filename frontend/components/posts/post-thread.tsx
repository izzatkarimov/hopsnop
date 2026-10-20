"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { unexpectedErrorMessage } from "@/lib/api";
import { createPost, getPost, listReplies } from "@/lib/posts";
import type { Post } from "@/lib/types";
import { FeedPanel, PostNotice } from "./feed-panel";
import { PostComposer } from "./post-composer";
import { PostItem, postHref } from "./post-item";
import { PostSkeleton } from "./post-skeleton";
import { useFeed } from "./use-feed";
import { usePostActions } from "./use-post-actions";
import type { PostContainer } from "./use-post-actions";

/** One post that is loaded on its own, and how that went. */
type Loaded =
  | { status: "loading" }
  /**
   * There is no such post to show. The backend gives one answer for a post
   * that never existed, one that was deleted and one whose author's account
   * is not shown, so they cannot be told apart here either.
   */
  | { status: "unavailable" }
  /** The request failed. The post may well exist. */
  | { status: "error"; message: string }
  | { status: "ready"; post: Post };

const buttonClass =
  "rounded-full bg-accent px-5 py-2 font-semibold text-accent-foreground transition-colors hover:bg-accent-hover";

/**
 * Loads one post, again whenever `postId` or `attempt` changes. Nothing is
 * requested for null.
 */
function useLoadedPost(postId: string | null, attempt: number) {
  const [state, setState] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    if (postId === null) return;
    // Set by the cleanup, so that a request this effect no longer cares
    // about cannot change the state.
    let ignore = false;

    getPost(postId).then(
      (post) => {
        if (ignore) return;
        setState(post ? { status: "ready", post } : { status: "unavailable" });
      },
      (error: unknown) => {
        if (ignore) return;
        setState({ status: "error", message: unexpectedErrorMessage(error) });
      },
    );

    return () => {
      ignore = true;
    };
  }, [postId, attempt]);

  /** The post as something whose posts can be changed and removed. */
  const container: PostContainer = {
    posts: state.status === "ready" ? [state.post] : [],
    updatePosts(change) {
      setState((current) => {
        if (current.status !== "ready") return current;
        const [post] = change([current.post]);
        // Taken out: it turned out not to exist any more.
        return post ? { status: "ready", post } : { status: "unavailable" };
      });
    },
  };

  return { state, setState, container };
}

/**
 * A post's own page: the post it answers, if it is a reply; the post; a
 * place to reply to it; and its direct replies, newest first. Replies to
 * those replies are on their own pages.
 *
 * Anyone may read it. Replying needs a session, so a visitor without one is
 * asked to log in instead; the backend refuses a reply without one anyway.
 */
export function PostThread({ postId }: { postId: string }) {
  const auth = useAuth();
  const viewer = auth.status === "authenticated" ? auth.user : null;
  const [attempt, setAttempt] = useState(0);
  const [parentAttempt, setParentAttempt] = useState(0);

  const main = useLoadedPost(postId, attempt);
  const post = main.state.status === "ready" ? main.state.post : null;
  const parentId = post?.parentPostId ?? null;
  const parent = useLoadedPost(parentId, parentAttempt);

  const loadReplies = useCallback(
    (cursor?: string | null) => listReplies(postId, { cursor }),
    [postId],
  );
  // Not before the post is known to be there: a post that is not shown has
  // no list of replies to ask for.
  const replies = useFeed(loadReplies, post !== null);

  const { handlers, notice } = usePostActions([
    main.container,
    parent.container,
    replies,
  ]);

  /** Rejects if the backend did not store the reply; the composer says why. */
  async function reply(content: string) {
    replies.addPost(await createPost(content, postId));
  }

  if (main.state.status === "loading") {
    return (
      <div role="status">
        <span className="sr-only">Loading post…</span>
        <PostSkeleton />
      </div>
    );
  }

  if (main.state.status === "error") {
    return (
      <div role="alert">
        <EmptyState
          title="Couldn't load this post"
          description={main.state.message}
          action={
            <button
              type="button"
              onClick={() => {
                main.setState({ status: "loading" });
                setAttempt((current) => current + 1);
              }}
              className={buttonClass}
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  if (main.state.status === "unavailable") {
    return (
      <>
        <PostNotice notice={notice} />
        <EmptyState
          title="This post is unavailable"
          description="It may have been deleted, or the link may be wrong."
          action={
            // Home needs a session: a visitor without one would only be
            // sent on to the login page from there.
            viewer ? (
              <Link href="/" className={buttonClass}>
                Go to Home
              </Link>
            ) : (
              <Link href="/login" className={buttonClass}>
                Log in
              </Link>
            )
          }
        />
      </>
    );
  }

  return (
    <>
      <PostNotice notice={notice} />

      {parentId !== null && (
        <ParentPost
          parentId={parentId}
          state={parent.state}
          handlers={handlers}
          onRetry={() => {
            parent.setState({ status: "loading" });
            setParentAttempt((current) => current + 1);
          }}
        />
      )}

      <PostItem post={main.state.post} handlers={handlers} replyHref="#reply" />

      {/* Below the sticky header when the reply control scrolls here. */}
      <div id="reply" className="scroll-mt-32">
        {viewer ? (
          <PostComposer viewer={viewer} kind="reply" onSubmit={reply} />
        ) : (
          <p className="border-b border-border px-4 py-3 text-body">
            <Link
              href="/login"
              className="font-semibold text-accent hover:underline"
            >
              Log in to reply
            </Link>
          </p>
        )}
      </div>

      <section aria-label="Replies">
        <FeedPanel
          feed={replies}
          handlers={handlers}
          errorTitle="Couldn't load replies"
          empty={
            <EmptyState
              title="No replies yet"
              description="Be the first to reply."
            />
          }
        />
      </section>
    </>
  );
}

type ParentPostProps = {
  parentId: string;
  state: Loaded;
  handlers: Parameters<typeof PostItem>[0]["handlers"];
  onRetry: () => void;
};

/**
 * The post that the page's post answers, above it. A parent that was
 * deleted is said to be gone; nothing is shown in its place, and the reply
 * below it stays what it is.
 */
function ParentPost({ parentId, state, handlers, onRetry }: ParentPostProps) {
  if (state.status === "loading") {
    return (
      <div role="status">
        <span className="sr-only">Loading the post this replies to…</span>
        <PostSkeleton />
      </div>
    );
  }

  if (state.status === "ready") {
    return <PostItem post={state.post} handlers={handlers} />;
  }

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 text-sm text-muted">
      {state.status === "unavailable" ? (
        "This is a reply to a post that was deleted or is no longer available."
      ) : (
        <>
          <span role="alert">Couldn&apos;t load the post this replies to.</span>
          <button
            type="button"
            onClick={onRetry}
            className="font-semibold text-accent hover:underline"
          >
            Try again
          </button>
          <Link href={postHref(parentId)} className="hover:underline">
            Open it
          </Link>
        </>
      )}
    </p>
  );
}
