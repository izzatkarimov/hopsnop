import { ApiError, apiRequest, isApiError } from "./api";
import { countCharacters, pageQuery } from "./posts";
import type { Story, StoryAuthor } from "./types";

/** After trimming. The backend's limit. */
export const STORY_CAPTION_MAX_LENGTH = 150;

/** Only a quick check; blank is no caption. */
export function validateStoryCaption(value: string): string | null {
  const caption = value.trim();
  if (countCharacters(caption) > STORY_CAPTION_MAX_LENGTH) {
    return `Use at most ${STORY_CAPTION_MAX_LENGTH} characters.`;
  }
  if (caption.includes("\0")) {
    return "This caption contains a character that can't be posted.";
  }
  return null;
}

/* A story is published as a form, so there is no JSON request type. */

export type StoryAuthorResponse = {
  username: string;
  display_name: string;
  avatar_url: string | null;
};

export type StoryResponse = {
  id: string;
  author: StoryAuthorResponse;
  media_url: string;
  media_width: number;
  media_height: number;
  media_type: string;
  caption: string | null;
  created_at: string;
  /** created_at plus 24 hours. */
  expires_at: string;
  /** Always false for its author. */
  viewed_by_me: boolean;
  /** Told to the author only; null for everyone else. */
  view_count: number | null;
};

export type StoryPageResponse = {
  items: StoryResponse[];
  next_cursor: string | null;
};

export type StoryViewResponse = {
  viewed: boolean;
};

/** The most the backend gives. */
const PAGE_SIZE = 50;

/** So at most 250 stories. */
const MAX_PAGES = 5;

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

export function toStory(response: unknown): Story {
  if (!isRecord(response) || !isRecord(response.author)) {
    throw unexpected("story");
  }
  const {
    id,
    author,
    media_url: mediaUrl,
    media_type: mediaType,
    media_width: mediaWidth,
    media_height: mediaHeight,
    caption,
    created_at: createdAt,
    expires_at: expiresAt,
    viewed_by_me: viewedByViewer,
    view_count: viewCount,
  } = response;
  const { username, display_name: displayName, avatar_url: avatarUrl } = author;

  if (
    typeof id !== "string" ||
    typeof username !== "string" ||
    typeof displayName !== "string" ||
    (typeof avatarUrl !== "string" && avatarUrl !== null) ||
    typeof mediaUrl !== "string" ||
    typeof mediaType !== "string" ||
    !isCount(mediaWidth) ||
    mediaWidth === 0 ||
    !isCount(mediaHeight) ||
    mediaHeight === 0 ||
    (typeof caption !== "string" && caption !== null) ||
    !isTimestamp(createdAt) ||
    !isTimestamp(expiresAt) ||
    typeof viewedByViewer !== "boolean" ||
    (!isCount(viewCount) && viewCount !== null)
  ) {
    throw unexpected("story");
  }

  return {
    id,
    author: { username, displayName, avatarUrl },
    mediaUrl,
    mediaType,
    mediaWidth,
    mediaHeight,
    caption,
    createdAt,
    expiresAt,
    viewedByViewer,
    viewCount,
  };
}

function toStoryPage(response: unknown): { stories: Story[]; nextCursor: string | null } {
  if (!isRecord(response) || !Array.isArray(response.items)) {
    throw unexpected("list of stories");
  }
  const { items, next_cursor: nextCursor } = response;
  if (typeof nextCursor !== "string" && nextCursor !== null) {
    throw unexpected("list of stories");
  }
  return { stories: items.map(toStory), nextCursor };
}

function storyPath(storyId: string): string {
  return `/stories/${encodeURIComponent(storyId)}`;
}

export async function listStories(): Promise<Story[]> {
  const stories: Story[] = [];
  const known = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response: unknown = await apiRequest<StoryPageResponse>(
      `/stories${pageQuery({ limit: PAGE_SIZE, cursor })}`,
    );
    const { stories: items, nextCursor } = toStoryPage(response);
    for (const story of items) {
      if (known.has(story.id)) continue;
      known.add(story.id);
      stories.push(story);
    }
    if (nextCursor === null) break;
    cursor = nextCursor;
  }
  return stories;
}

export async function getStory(storyId: string): Promise<Story | null> {
  try {
    return toStory(await apiRequest<StoryResponse>(storyPath(storyId)));
  } catch (error) {
    if (isApiError(error) && error.kind === "not_found") return null;
    throw error;
  }
}

/** "validation": caption or file refused; status 413: too large; "rate_limited". */
export async function createStory(file: Blob, caption: string): Promise<Story> {
  const form = new FormData();
  form.append("image", file);
  const trimmed = caption.trim();
  if (trimmed) form.append("caption", trimmed);

  return toStory(
    await apiRequest<StoryResponse>("/stories", { method: "POST", form }),
  );
}

/** Never recorded for one's own story. Can be repeated. */
export async function recordStoryView(storyId: string): Promise<boolean> {
  const response: unknown = await apiRequest<StoryViewResponse>(
    `${storyPath(storyId)}/view`,
    { method: "POST" },
  );
  if (!isRecord(response) || typeof response.viewed !== "boolean") {
    throw unexpected("view");
  }
  return response.viewed;
}

export async function deleteStory(storyId: string): Promise<void> {
  await apiRequest<void>(storyPath(storyId), { method: "DELETE" });
}

export type StoryGroup = {
  author: StoryAuthor;
  isOwn: boolean;
  /** Oldest first, the order they are played in. Never empty. */
  stories: Story[];
  hasUnviewed: boolean;
};

export function groupStories(
  stories: Story[],
  viewerUsername: string,
): StoryGroup[] {
  const newestFirst = [...stories].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const groups = new Map<string, StoryGroup>();

  for (const story of newestFirst) {
    const { username } = story.author;
    let group = groups.get(username);
    if (!group) {
      group = {
        author: story.author,
        isOwn: username === viewerUsername,
        stories: [],
        hasUnviewed: false,
      };
      groups.set(username, group);
    }
    group.stories.push(story);
    if (!group.isOwn && !story.viewedByViewer) group.hasUnviewed = true;
  }

  const all = [...groups.values()];
  for (const group of all) group.stories.reverse();
  return [...all.filter((group) => group.isOwn), ...all.filter((group) => !group.isOwn)];
}
