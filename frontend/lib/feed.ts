import { apiRequest } from "./api";
import { pageQuery, toPostPage } from "./posts";
import type { PostPage, PostPageResponse } from "./posts";

/*
 * Feed endpoints of the Hopsnop API. Both return one page of posts, newest
 * first, replies included; the order is the backend's and is kept as it is.
 * Pass a page's nextCursor back to the same function to get the page after.
 */

/**
 * One page of the For You feed: every post that is shown. Needs no session;
 * with one, each post says whether the viewer liked or reposted it.
 */
export async function getForYouFeed(
  cursor?: string | null,
  limit?: number,
): Promise<PostPage> {
  return toPostPage(
    await apiRequest<PostPageResponse>(`/feed${pageQuery({ cursor, limit })}`),
  );
}

/**
 * One page of the Following feed: the posts of the users the signed-in user
 * follows. Their own posts are never in it. Requires a session: without one
 * the ApiError is "unauthenticated".
 */
export async function getFollowingFeed(
  cursor?: string | null,
  limit?: number,
): Promise<PostPage> {
  return toPostPage(
    await apiRequest<PostPageResponse>(
      `/feed/following${pageQuery({ cursor, limit })}`,
    ),
  );
}
