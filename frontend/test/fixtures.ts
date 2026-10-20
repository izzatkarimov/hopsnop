import type { PostAuthorResponse, PostPageResponse, PostResponse } from "@/lib/posts";
import type { PublicProfileResponse } from "@/lib/profiles";
import { account } from "./render";

/*
 * Answers in the backend's own shapes (lib/posts.ts, lib/profiles.ts), for
 * the fetch mock. Made-up people; none of them exists anywhere.
 */

export const viewerAuthor: PostAuthorResponse = {
  id: account.id,
  username: account.username,
  display_name: account.display_name,
  avatar_url: null,
};

export const alice: PostAuthorResponse = {
  id: "a11ce000-0000-4000-8000-000000000001",
  username: "alice_92",
  display_name: "Alice Example",
  avatar_url: null,
};

export const bob: PostAuthorResponse = {
  id: "b0b00000-0000-4000-8000-000000000002",
  username: "bob_77",
  display_name: "Bob Example",
  avatar_url: null,
};

/** A post id: post ids are UUIDs, and the app asks for nothing else. */
export function postId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function post(n: number, author: PostAuthorResponse, extra: Partial<PostResponse> = {}): PostResponse {
  return {
    id: postId(n),
    author,
    content: `Post number ${n}`,
    parent_post_id: null,
    created_at: "2026-10-19T09:00:00.000000Z",
    updated_at: "2026-10-19T09:00:00.000000Z",
    like_count: 2,
    liked_by_me: false,
    repost_count: 1,
    reposted_by_me: false,
    is_reply: false,
    ...extra,
  };
}

export function page(items: PostResponse[], nextCursor: string | null = null): PostPageResponse {
  return { items, next_cursor: nextCursor };
}

export function profile(
  author: PostAuthorResponse,
  extra: Partial<PublicProfileResponse> = {},
): PublicProfileResponse {
  return {
    id: author.id,
    username: author.username,
    display_name: author.display_name,
    bio: null,
    avatar_url: author.avatar_url,
    followers_count: 3,
    following_count: 1,
    created_at: "2026-02-01T10:00:00.000000Z",
    following: false,
    ...extra,
  };
}
