/*
 * Frontend domain types.
 * These describe what the UI needs, not how the backend stores data. They
 * are made from API responses by the mappers in lib/auth.ts, lib/profiles.ts,
 * lib/posts.ts and lib/sessions.ts, which is where the backend's field names
 * end.
 */

/** The little that is needed to show a person next to their content. */
export type User = {
  id: string;
  username: string;
  displayName: string;
  /** Absolute http(s) URL of the user's picture, if they have set one. */
  avatarUrl?: string | null;
};

/**
 * A user's profile page data. It holds only what anyone may see: private
 * account fields such as the email address are not part of it.
 */
export type Profile = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followersCount: number;
  followingCount: number;
};

/** A profile as returned to someone looking at it: it adds their relation. */
export type PublicProfile = Profile & {
  /** Whether the current user follows this user. False without a session. */
  followedByViewer: boolean;
};

/**
 * A post, or a reply to one: a reply is a post with a parent. The backend
 * only ever returns posts that are shown, so there is no deleted state.
 */
export type Post = {
  /** A UUID, assigned by the backend. */
  id: string;
  author: User;
  content: string;
  /**
   * The post this one replies to, or null. The parent may no longer be
   * available: a deleted post leaves its replies in place.
   */
  parentPostId: string | null;
  isReply: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp. Equal to createdAt for a post that was never edited. */
  updatedAt: string;
  repostCount: number;
  likeCount: number;
  /**
   * Viewer-relative state: whether the current user liked/reposted it.
   * Always false without a session.
   */
  likedByViewer: boolean;
  repostedByViewer: boolean;
};

/**
 * One place where the user is signed in. The backend records only when it
 * started, was last used and expires: there is no device or location.
 */
export type Session = {
  /** A UUID, assigned by the backend. Needed to end the session. */
  id: string;
  /** ISO 8601 timestamp: when the user signed in. */
  createdAt: string;
  /** ISO 8601 timestamp. */
  lastUsedAt: string;
  /** ISO 8601 timestamp. */
  expiresAt: string;
  /** Whether this is the session of this browser. */
  isCurrent: boolean;
};
