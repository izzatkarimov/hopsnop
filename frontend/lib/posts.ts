import { ApiError, apiRequest, isApiError } from "./api";
import type { Post } from "./types";

/** Counted after trimming; the backend remains the authority. */
export const POST_MAX_LENGTH = 300;

/** Unicode code points, as the backend counts: an emoji is one. */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

export type PostContentCheck = {
  content: string;
  remaining: number;
  isOverLimit: boolean;
  /** The backend refuses this character. Pasted text can carry one. */
  hasNullCharacter: boolean;
  isValid: boolean;
};

/** Only a hint for the form: the backend checks again. */
export function checkPostContent(text: string): PostContentCheck {
  const content = text.trim();
  const remaining = POST_MAX_LENGTH - countCharacters(content);
  const isOverLimit = remaining < 0;
  const hasNullCharacter = content.includes("\0");
  return {
    content,
    remaining,
    isOverLimit,
    hasNullCharacter,
    isValid: content.length > 0 && !isOverLimit && !hasNullCharacter,
  };
}

/** Counted from creation, not moved by edits, as in the backend. */
export const POST_EDIT_WINDOW_MINUTES = 60;

/** By this device's clock, only to offer editing; the backend's clock counts. */
export function isWithinEditWindow(
  post: Pick<Post, "createdAt">,
  now = Date.now(),
): boolean {
  const deadline =
    Date.parse(post.createdAt) + POST_EDIT_WINDOW_MINUTES * 60_000;
  return now < deadline;
}

export function isEdited(post: Pick<Post, "createdAt" | "updatedAt">): boolean {
  return Date.parse(post.updatedAt) !== Date.parse(post.createdAt);
}

export type ContentSegment =
  | { type: "text"; value: string }
  | { type: "mention"; username: string };

const MENTION_PATTERN = /(@[A-Za-z0-9_]+)/;

/** A mention starts the text or follows whitespace, so emails aren't mentions. */
export function parsePostContent(content: string): ContentSegment[] {
  // split() with a capture group puts the mentions at odd indexes.
  const parts = content.split(MENTION_PATTERN);
  const segments: ContentSegment[] = [];
  let textBefore = "";

  parts.forEach((part, index) => {
    const isMentionCandidate = index % 2 === 1;
    const startsWord = textBefore === "" || /\s$/.test(textBefore);

    if (isMentionCandidate && startsWord) {
      segments.push({ type: "mention", username: part.slice(1) });
    } else if (part !== "") {
      segments.push({ type: "text", value: part });
    }

    textBefore += part;
  });

  return segments;
}

/* Types mirror app/schemas/post.py; the functions return the frontend's types. */

export type PostAuthorResponse = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

export type PostResponse = {
  id: string;
  author: PostAuthorResponse;
  content: string;
  parent_post_id: string | null;
  created_at: string;
  /** Equal to created_at for a post never edited. */
  updated_at: string;
  like_count: number;
  liked_by_me: boolean;
  repost_count: number;
  reposted_by_me: boolean;
  is_reply: boolean;
};

export type PostPageResponse = {
  items: PostResponse[];
  next_cursor: string | null;
};

export type CreatePostRequest = {
  content: string;
  parent_post_id?: string;
};

export type UpdatePostRequest = {
  content: string;
};

export type LikeResponse = {
  liked: boolean;
  like_count: number;
};

export type RepostResponse = {
  reposted: boolean;
  repost_count: number;
};

export type PostPage = {
  posts: Post[];
  nextCursor: string | null;
};

export type PageOptions = {
  /** Opaque: only ever passed back. */
  cursor?: string | null;
  /** 1 to 50. The backend's default is 20. */
  limit?: number;
};

export type LikeState = {
  liked: boolean;
  likeCount: number;
};

export type RepostState = {
  reposted: boolean;
  repostCount: number;
};

const POST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPostId(value: string): boolean {
  return POST_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function unexpected(what: string): ApiError {
  return new ApiError("server", null, `The server sent an unexpected ${what}.`);
}

/** Refused if anything is missing or mistyped: the UI never invents a default. */
export function toPost(response: unknown): Post {
  if (!isRecord(response) || !isRecord(response.author)) {
    throw unexpected("post");
  }
  const {
    id,
    author,
    content,
    parent_post_id: parentPostId,
    created_at: createdAt,
    updated_at: updatedAt,
    like_count: likeCount,
    liked_by_me: likedByViewer,
    repost_count: repostCount,
    reposted_by_me: repostedByViewer,
    is_reply: isReply,
  } = response;
  const {
    id: authorId,
    username,
    display_name: displayName,
    avatar_url: avatarUrl,
  } = author;

  if (
    typeof id !== "string" ||
    typeof authorId !== "string" ||
    typeof username !== "string" ||
    typeof displayName !== "string" ||
    (typeof avatarUrl !== "string" && avatarUrl !== null) ||
    typeof content !== "string" ||
    (typeof parentPostId !== "string" && parentPostId !== null) ||
    !isTimestamp(createdAt) ||
    !isTimestamp(updatedAt) ||
    !isCount(likeCount) ||
    typeof likedByViewer !== "boolean" ||
    !isCount(repostCount) ||
    typeof repostedByViewer !== "boolean" ||
    typeof isReply !== "boolean"
  ) {
    throw unexpected("post");
  }

  return {
    id,
    author: { id: authorId, username, displayName, avatarUrl },
    content,
    parentPostId,
    isReply,
    createdAt,
    updatedAt,
    repostCount,
    likeCount,
    likedByViewer,
    repostedByViewer,
  };
}

export function toPostPage(response: unknown): PostPage {
  if (!isRecord(response) || !Array.isArray(response.items)) {
    throw unexpected("list of posts");
  }
  const { items, next_cursor: nextCursor } = response;
  if (typeof nextCursor !== "string" && nextCursor !== null) {
    throw unexpected("list of posts");
  }
  return { posts: items.map(toPost), nextCursor };
}

export function pageQuery({ cursor, limit }: PageOptions = {}): string {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function postPath(postId: string): string {
  return `/posts/${encodeURIComponent(postId)}`;
}

export async function createPost(
  content: string,
  parentPostId?: string,
): Promise<Post> {
  const body: CreatePostRequest = { content };
  if (parentPostId !== undefined) body.parent_post_id = parentPostId;

  return toPost(
    await apiRequest<PostResponse>("/posts", { method: "POST", body }),
  );
}

/** The backend allows 60 minutes from creation; editing doesn't extend that. */
export async function updatePost(
  postId: string,
  content: string,
): Promise<Post> {
  const body: UpdatePostRequest = { content };
  return toPost(
    await apiRequest<PostResponse>(postPath(postId), { method: "PATCH", body }),
  );
}

export async function deletePost(postId: string): Promise<void> {
  await apiRequest<void>(postPath(postId), { method: "DELETE" });
}

/** Asking for what is already the case is not an error. */
export async function setLike(
  postId: string,
  liked: boolean,
): Promise<LikeState> {
  const response: unknown = await apiRequest<LikeResponse>(
    `${postPath(postId)}/like`,
    { method: liked ? "POST" : "DELETE" },
  );
  if (
    !isRecord(response) ||
    typeof response.liked !== "boolean" ||
    !isCount(response.like_count)
  ) {
    throw unexpected("like");
  }
  return { liked: response.liked, likeCount: response.like_count };
}

/** Asking for what is already the case is not an error. */
export async function setRepost(
  postId: string,
  reposted: boolean,
): Promise<RepostState> {
  const response: unknown = await apiRequest<RepostResponse>(
    `${postPath(postId)}/repost`,
    { method: reposted ? "POST" : "DELETE" },
  );
  if (
    !isRecord(response) ||
    typeof response.reposted !== "boolean" ||
    !isCount(response.repost_count)
  ) {
    throw unexpected("repost");
  }
  return { reposted: response.reposted, repostCount: response.repost_count };
}

/** One backend answer for every reason a post is unavailable; same here. */
export async function getPost(postId: string): Promise<Post | null> {
  // No post can have an id of another shape.
  if (!isPostId(postId)) return null;

  try {
    return toPost(await apiRequest<PostResponse>(postPath(postId)));
  } catch (error) {
    if (isApiError(error) && error.kind === "not_found") return null;
    throw error;
  }
}

export async function listReplies(
  postId: string,
  page?: PageOptions,
): Promise<PostPage> {
  return toPostPage(
    await apiRequest<PostPageResponse>(
      `${postPath(postId)}/replies${pageQuery(page)}`,
    ),
  );
}

export async function listUserPosts(
  username: string,
  page?: PageOptions,
): Promise<PostPage> {
  return toPostPage(
    await apiRequest<PostPageResponse>(
      `/users/${encodeURIComponent(username)}/posts${pageQuery(page)}`,
    ),
  );
}
