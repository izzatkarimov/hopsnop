import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PostList } from "./post-list";
import { PostSkeleton } from "./post-skeleton";
import type { Feed } from "./use-feed";
import type { PostHandlers } from "./use-post-actions";

type FeedPanelProps = {
  feed: Feed;
  handlers: PostHandlers;
  /** Shown in place of the list's own message when there are no posts. */
  empty?: ReactNode;
  /** What could not be loaded, for the error message. */
  errorTitle?: string;
};

/**
 * What a list of posts shows: its posts and a way to load more of them, or
 * why there are none to show.
 */
export function FeedPanel({
  feed,
  handlers,
  empty,
  errorTitle = "Couldn't load posts",
}: FeedPanelProps) {
  const { state } = feed;

  if (state.status === "loading") {
    return (
      <div role="status">
        <span className="sr-only">Loading posts…</span>
        {Array.from({ length: 5 }, (_, index) => (
          <PostSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert">
        <EmptyState
          title={errorTitle}
          description={state.message}
          action={
            <button
              type="button"
              onClick={feed.retry}
              className="rounded-full bg-accent px-5 py-2 font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  if (state.posts.length === 0 && state.nextCursor === null && empty) {
    return empty;
  }

  return (
    <>
      <PostList posts={state.posts} handlers={handlers} />

      {state.nextCursor !== null && (
        <div className="flex flex-col items-center gap-3 px-4 py-6">
          {state.loadMoreError && (
            <Notice tone="error">{state.loadMoreError}</Notice>
          )}
          <button
            type="button"
            onClick={feed.loadMore}
            disabled={state.loadingMore}
            className="rounded-full border border-border px-5 py-1.5 text-body font-semibold transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}

/** What happened to a post that is no longer in the list, if anything did. */
export function PostNotice({ notice }: { notice: string | null }) {
  if (!notice) return null;
  return (
    <div className="border-b border-border px-4 py-3">
      <Notice tone="info">{notice}</Notice>
    </div>
  );
}
