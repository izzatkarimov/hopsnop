import { apiRequest } from "./api";
import { pageQuery, toPostPage } from "./posts";
import type { PostPage, PostPageResponse } from "./posts";

export async function getForYouFeed(
  cursor?: string | null,
  limit?: number,
): Promise<PostPage> {
  return toPostPage(
    await apiRequest<PostPageResponse>(`/feed${pageQuery({ cursor, limit })}`),
  );
}

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
