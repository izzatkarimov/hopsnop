/* What the UI needs, made from API responses by the mappers in lib/. */

export type User = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

/** Only what anyone may see: no private account fields. */
export type Profile = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followersCount: number;
  followingCount: number;
};

export type PublicProfile = Profile & {
  followedByViewer: boolean;
};

/** The backend only returns shown posts, so there is no deleted state. */
export type Post = {
  id: string;
  author: User;
  content: string;
  /** The parent may no longer be available: a deleted post leaves its replies. */
  parentPostId: string | null;
  isReply: boolean;
  createdAt: string;
  updatedAt: string;
  repostCount: number;
  likeCount: number;
  likedByViewer: boolean;
  repostedByViewer: boolean;
};

/** By username, which never changes; a story has no author id. */
export type StoryAuthor = {
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export type Story = {
  id: string;
  author: StoryAuthor;
  mediaUrl: string;
  mediaType: string;
  mediaWidth: number;
  mediaHeight: number;
  caption: string | null;
  createdAt: string;
  /** From this moment on, the story is not shown. */
  expiresAt: string;
  viewedByViewer: boolean;
  viewCount: number | null;
};

/** The backend records only start, last use and expiry: no device or location. */
export type Session = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  isCurrent: boolean;
};
