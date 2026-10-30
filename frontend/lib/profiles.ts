import { ApiError, apiRequest, isApiError } from "./api";
import { isUsername } from "./auth-validation";
import type { Profile, PublicProfile } from "./types";

type ProfileFields = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  /** A new picture has a new path. Load it through apiAssetUrl(). */
  avatar_url: string | null;
  followers_count: number;
  following_count: number;
  created_at: string;
};

export type PublicProfileResponse = ProfileFields & {
  /** False without a session. */
  following: boolean;
};

export type MyProfileResponse = ProfileFields & {
  email: string;
  email_verified_at: string | null;
};

/** null clears bio; display_name can't be cleared; the picture is uploaded apart. */
export type UpdateProfileRequest = {
  display_name?: string;
  bio?: string | null;
};

export type FollowResponse = {
  following: boolean;
};

/** Drops private fields, so they never reach application state. */
function toProfile(response: ProfileFields): Profile {
  const {
    id,
    username,
    display_name: displayName,
    avatar_url: avatarUrl,
    bio,
    followers_count: followersCount,
    following_count: followingCount,
  } = response;

  if (
    typeof id !== "string" ||
    typeof username !== "string" ||
    typeof displayName !== "string" ||
    (typeof avatarUrl !== "string" && avatarUrl !== null) ||
    (typeof bio !== "string" && bio !== null) ||
    typeof followersCount !== "number" ||
    typeof followingCount !== "number"
  ) {
    throw new ApiError("server", null, "The server sent an unexpected profile.");
  }

  return {
    id,
    username,
    displayName,
    avatarUrl,
    bio,
    followersCount,
    followingCount,
  };
}

export async function getCurrentProfile(): Promise<Profile> {
  return toProfile(await apiRequest<MyProfileResponse>("/users/me"));
}

/** The backend rejects an empty set of changes: send at least one field. */
export async function updateCurrentProfile(
  changes: UpdateProfileRequest,
): Promise<Profile> {
  const response = await apiRequest<MyProfileResponse>("/users/me", {
    method: "PATCH",
    body: changes,
  });
  return toProfile(response);
}

/** "validation": unreadable; "bad_request" (413): too large; or "rate_limited". */
export async function setCurrentAvatar(file: Blob): Promise<Profile> {
  const form = new FormData();
  form.append("image", file);
  return toProfile(
    await apiRequest<MyProfileResponse>("/users/me/avatar", {
      method: "PUT",
      form,
    }),
  );
}

export async function removeCurrentAvatar(): Promise<Profile> {
  return toProfile(
    await apiRequest<MyProfileResponse>("/users/me/avatar", { method: "DELETE" }),
  );
}

/** One backend answer for every reason a profile is unavailable; same here. */
export async function getPublicProfile(
  username: string,
): Promise<PublicProfile | null> {
  // Also keeps a name like "me" from being read as the /users/me path.
  if (!isUsername(username)) return null;

  try {
    const response = await apiRequest<PublicProfileResponse>(
      `/users/${encodeURIComponent(username)}`,
    );
    const profile = toProfile(response);
    if (typeof response.following !== "boolean") {
      throw new ApiError("server", null, "The server sent an unexpected profile.");
    }
    return { ...profile, followedByViewer: response.following };
  } catch (error) {
    if (isApiError(error) && error.kind === "not_found") return null;
    throw error;
  }
}

/** "not_found" for no such account, "bad_request" for following oneself. */
export async function setFollow(
  username: string,
  following: boolean,
): Promise<boolean> {
  const response = await apiRequest<FollowResponse>(
    `/users/${encodeURIComponent(username)}/follow`,
    { method: following ? "POST" : "DELETE" },
  );
  if (typeof response?.following !== "boolean") {
    throw new ApiError("server", null, "The server sent an unexpected answer.");
  }
  return response.following;
}
