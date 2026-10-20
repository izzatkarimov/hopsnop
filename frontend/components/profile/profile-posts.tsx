"use client";

import { useCallback } from "react";
import { FeedPanel, PostNotice } from "@/components/posts/feed-panel";
import { useFeed } from "@/components/posts/use-feed";
import { usePostActions } from "@/components/posts/use-post-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { listUserPosts } from "@/lib/posts";

type ProfilePostsProps = {
  username: string;
  /** Whose posts these are, for the message shown when there are none. */
  displayName: string;
};

/**
 * A user's posts, newest first, replies included, loaded from
 * GET /users/{username}/posts. Works with or without a session.
 */
export function ProfilePosts({ username, displayName }: ProfilePostsProps) {
  const loadPosts = useCallback(
    (cursor?: string | null) => listUserPosts(username, { cursor }),
    [username],
  );
  const posts = useFeed(loadPosts, true);
  const { handlers, notice } = usePostActions([posts]);

  return (
    <section aria-label="Posts">
      <PostNotice notice={notice} />
      <FeedPanel
        feed={posts}
        handlers={handlers}
        empty={
          <EmptyState
            title="No posts yet"
            description={`When ${displayName} posts, it will show up here.`}
          />
        }
      />
    </section>
  );
}
