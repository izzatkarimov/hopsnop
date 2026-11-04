import type { LoginChallengeResponse, TwoFactorStartResponse } from "@/lib/auth";
import type { PostAuthorResponse, PostPageResponse, PostResponse } from "@/lib/posts";
import type { MyProfileResponse, PublicProfileResponse } from "@/lib/profiles";
import type { StoryPageResponse, StoryResponse } from "@/lib/stories";
import { account } from "./render";

/* Made-up people; none of them exists. */

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

export function storyId(n: number): string {
  return `5707e000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** `n` minutes before now: a lower number is newer. */
export function story(
  n: number,
  author: PostAuthorResponse,
  extra: Partial<StoryResponse> = {},
): StoryResponse {
  const created = Date.now() - n * 60_000;
  return {
    id: storyId(n),
    author: {
      username: author.username,
      display_name: author.display_name,
      avatar_url: author.avatar_url,
    },
    media_url: `/stories/${storyId(n)}/media`,
    media_width: 1080,
    media_height: 1440,
    media_type: "image",
    caption: null,
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + 24 * 60 * 60_000).toISOString(),
    viewed_by_me: false,
    view_count: author.username === account.username ? 0 : null,
    ...extra,
  };
}

export function storyPage(items: StoryResponse[], nextCursor: string | null = null): StoryPageResponse {
  return { items, next_cursor: nextCursor };
}

export function myProfile(extra: Partial<MyProfileResponse> = {}): MyProfileResponse {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    display_name: account.display_name,
    bio: null,
    avatar_url: null,
    email_verified_at: account.email_verified_at,
    two_factor_enabled: false,
    recovery_codes_left: 0,
    followers_count: 3,
    following_count: 1,
    created_at: account.created_at,
    ...extra,
  };
}

/* Made-up secrets in the backend's formats; none of them opens anything. */

export const LOGIN_CHALLENGE: LoginChallengeResponse = {
  challenge: "ZmFrZS1jaGFsbGVuZ2UtZm9yLXRlc3RzLW9ubHktOWQ3YzJm",
  expires_at: "2026-11-04T10:05:00.000000Z",
};

export const TWO_FACTOR_SETUP: TwoFactorStartResponse = {
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  otpauth_uri:
    "otpauth://totp/Hopsnop:test_viewer?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Hopsnop&algorithm=SHA1&digits=6&period=30",
};

export const RECOVERY_CODES = [
  "7K3M-Q9TX-2HVD-W8RP",
  "B4NZ-6CJE-XR1T-5GQM",
  "H2WF-8PKV-Z0AN-3DYS",
  "M9QC-4TBR-7JXE-1VWK",
  "R5GD-0YHN-6MSZ-8CPA",
  "T1VX-3EQK-9BFW-2NJH",
  "W6ZP-5RMA-4GTC-0KYD",
  "X8JS-1NWD-3HQV-7EBF",
  "Y0CT-9KGZ-5PRX-6MAJ",
  "Z3EB-2VFY-8DNK-4WHS",
];
