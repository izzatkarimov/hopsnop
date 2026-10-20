import { ApiError, apiRequest, isApiError } from "./api";
import type { Post } from "./types";

/**
 * Maximum post length in characters, counted after surrounding whitespace
 * is removed. The same limit as the backend's, which remains the authority.
 */
export const POST_MAX_LENGTH = 300;

/**
 * Counts characters as Unicode code points, so an emoji counts as one
 * character. This matches how the backend counts.
 */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

/** What a text would be as a post, and whether the backend would take it. */
export type PostContentCheck = {
  /** The text as it would be stored: without surrounding whitespace. */
  content: string;
  /** Characters left before the limit; negative when over it. */
  remaining: number;
  isOverLimit: boolean;
  /** The backend refuses this character. Pasted text can carry one. */
  hasNullCharacter: boolean;
  /** Whether the text follows every rule: 1 to POST_MAX_LENGTH characters. */
  isValid: boolean;
};

/**
 * Checks a text against the backend's rules for the text of a post or a
 * reply. Only a hint for the form: the backend checks again and decides.
 */
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

/**
 * How long after it was created a post can be edited. The same as the
 * backend's, which counts from the creation time and is not moved by edits.
 */
export const POST_EDIT_WINDOW_MINUTES = 60;

/**
 * Whether the post is still young enough to be edited, by this device's
 * clock. Only decides whether editing is offered: the backend has the
 * clock that counts and refuses an edit that comes too late.
 */
export function isWithinEditWindow(
  post: Pick<Post, "createdAt">,
  now = Date.now(),
): boolean {
  const deadline =
    Date.parse(post.createdAt) + POST_EDIT_WINDOW_MINUTES * 60_000;
  return now < deadline;
}

/** Whether the post's text was changed after it was published. */
export function isEdited(post: Pick<Post, "createdAt" | "updatedAt">): boolean {
  return Date.parse(post.updatedAt) !== Date.parse(post.createdAt);
}

export type ContentSegment =
  | { type: "text"; value: string }
  | { type: "mention"; username: string };

const MENTION_PATTERN = /(@[A-Za-z0-9_]+)/;

/**
 * Splits post text into plain text and @mention segments.
 * A mention must start the text or follow whitespace, so emails such as
 * "name@example.com" are not treated as mentions.
 * Returns data only; rendering is left to React, which escapes all text.
 */
export function parsePostContent(content: string): ContentSegment[] {
  // split() with a capture group puts the matched mentions at odd indexes.
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

/*
 * Post endpoints of the Hopsnop API.
 *
 * The response and request types mirror the backend's schemas
 * (app/schemas/post.py) and use its snake_case field names. The functions
 * return the frontend's types instead.
 *
 * Every function throws ApiError. Beyond "network" and "server", the kinds
 * to expect are named on each function; "unauthenticated" means the session
 * is gone, for every function that needs one.
 */

/** What a post shows of its author. */
export type PostAuthorResponse = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

/** A post as the backend returns it, wherever it returns one. */
export type PostResponse = {
  id: string;
  author: PostAuthorResponse;
  content: string;
  parent_post_id: string | null;
  /** ISO 8601 timestamp. */
  created_at: string;
  /** ISO 8601 timestamp. Equal to created_at for a post never edited. */
  updated_at: string;
  like_count: number;
  liked_by_me: boolean;
  repost_count: number;
  reposted_by_me: boolean;
  is_reply: boolean;
};

/** One page of a list of posts, newest first. */
export type PostPageResponse = {
  items: PostResponse[];
  /** Null when there are no more posts. */
  next_cursor: string | null;
};

/** Body of POST /posts. */
export type CreatePostRequest = {
  content: string;
  parent_post_id?: string;
};

/** Body of PATCH /posts/{id}. The text is all that can change. */
export type UpdatePostRequest = {
  content: string;
};

/** Returned by POST and DELETE /posts/{id}/like. */
export type LikeResponse = {
  liked: boolean;
  like_count: number;
};

/** Returned by POST and DELETE /posts/{id}/repost. */
export type RepostResponse = {
  reposted: boolean;
  repost_count: number;
};

/** One page of posts, in the order the backend returned them. */
export type PostPage = {
  posts: Post[];
  /** Pass to the same function to get the next page. Null on the last one. */
  nextCursor: string | null;
};

/** Which page of a list to ask for. */
export type PageOptions = {
  /** The nextCursor of the previous page. Opaque: only ever passed back. */
  cursor?: string | null;
  /** 1 to 50. The backend's default is 20. */
  limit?: number;
};

/** Where a post stands with the viewer's like after a request. */
export type LikeState = {
  liked: boolean;
  likeCount: number;
};

/** Where a post stands with the viewer's repost after a request. */
export type RepostState = {
  reposted: boolean;
  repostCount: number;
};

const POST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value, e.g. one taken from a URL, has the shape of a post id. */
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

/**
 * Turns a post response into a Post. The response is checked field by field
 * and refused if anything is missing or of the wrong type: nothing is filled
 * in with a default, so the UI never shows a value the backend did not send.
 */
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

/** Turns one page of posts into a PostPage, keeping the backend's order. */
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

/** The query string that asks for a page, or "" for the default first page. */
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

/**
 * Publishes a post, or a reply if parentPostId is given, and returns it.
 * Requires a session.
 *
 * "validation": the text was rejected (fieldErrors.content). "not_found": the
 * post being replied to does not exist or is no longer available.
 */
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

/**
 * Replaces the text of the signed-in user's own post and returns the result.
 * The backend allows this for 60 minutes after the post was created; editing
 * does not extend that time.
 *
 * "validation": the text was rejected (fieldErrors.content). "not_found": no
 * such post, or it was deleted. "forbidden": not the caller's post.
 * "conflict": the post can no longer be edited.
 */
export async function updatePost(
  postId: string,
  content: string,
): Promise<Post> {
  const body: UpdatePostRequest = { content };
  return toPost(
    await apiRequest<PostResponse>(postPath(postId), { method: "PATCH", body }),
  );
}

/**
 * Deletes the signed-in user's own post, for good. The backend answers
 * without a body.
 *
 * "not_found": no such post, which includes one that is already deleted.
 * "forbidden": not the caller's post.
 */
export async function deletePost(postId: string): Promise<void> {
  await apiRequest<void>(postPath(postId), { method: "DELETE" });
}

/**
 * Makes the signed-in user like the post (true) or no longer like it
 * (false), and returns where the post then stands according to the backend.
 * Asking for what is already the case is not an error.
 *
 * "not_found": no such post, or it is no longer available.
 */
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

/**
 * Makes the signed-in user repost the post (true) or no longer repost it
 * (false), and returns where the post then stands according to the backend.
 * Asking for what is already the case is not an error.
 *
 * "not_found": no such post, or it is no longer available.
 */
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

/**
 * A single post, or null if there is no such post to show. Needs no session.
 * The backend gives one answer for every reason a post is unavailable
 * (unknown, deleted, author's account not shown), and so does this.
 */
export async function getPost(postId: string): Promise<Post | null> {
  // No post can have an id of another shape, so there is nothing to ask.
  if (!isPostId(postId)) return null;

  try {
    return toPost(await apiRequest<PostResponse>(postPath(postId)));
  } catch (error) {
    if (isApiError(error) && error.kind === "not_found") return null;
    throw error;
  }
}

/**
 * One page of the direct replies to a post, newest first. Needs no session.
 *
 * "not_found": the post itself does not exist or is no longer available.
 */
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

/**
 * One page of a user's posts, newest first, replies included. Needs no
 * session.
 *
 * "not_found": there is no such account, or it is not available.
 */
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
