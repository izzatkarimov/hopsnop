import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PostList } from "./post-list";
import { PostSkeleton } from "./post-skeleton";
import type { Feed } from "./use-feed";
import type { PostHandlers } from "./use-post-actions";

type FeedPanelProps = {
  feed: Feed;
  handlers: PostHandlers;
  empty?: ReactNode;
  errorTitle?: string;
};

/** The rows only: the caller puts them in a tile. */
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
            <Button variant="primary" onClick={feed.retry}>
              Try again
            </Button>
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
        <div className="flex flex-col items-center gap-3 px-4 py-4">
          {state.loadMoreError && <Notice tone="error">{state.loadMoreError}</Notice>}
          <Button onClick={feed.loadMore} disabled={state.loadingMore}>
            {state.loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}

export function PostNotice({ notice }: { notice: string | null }) {
  if (!notice) return null;
  return <Notice tone="info">{notice}</Notice>;
}
