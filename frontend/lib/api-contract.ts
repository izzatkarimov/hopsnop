/*
 * The frontend's API types, checked against the backend's own description.
 *
 * lib/api-schema.d.ts is generated from the backend's OpenAPI schema
 * (`npm run api:types`, see the root README). The types in lib/posts.ts,
 * lib/auth.ts and the rest are written by hand, because they say more than
 * the schema can: what each field means, and in requests the narrower values
 * this frontend actually sends. This file makes the compiler hold the two
 * together. It contains no code; `tsc` reads it, nothing imports it.
 *
 * - A response type must be exactly the backend's: a field added, removed,
 *   renamed or made nullable there fails here, before any page breaks.
 * - A request type must be something the backend accepts. It may be
 *   narrower: the frontend never sends a null display name, say, which the
 *   schema allows only for the backend to refuse it. It may not have a field
 *   the backend does not know: the backend ignores such a field, so a
 *   request that relies on one (as the frontend once sent `avatar_url` in a
 *   profile update) would do nothing, without any error.
 *
 * When the backend changes, regenerate the schema and the types; whatever
 * fails below is what the frontend has to follow.
 */

import type { components } from "./api-schema";
import type * as auth from "./auth";
import type * as exporting from "./export";
import type * as posts from "./posts";
import type * as profiles from "./profiles";
import type * as sessions from "./sessions";

type Schema = components["schemas"];

/** Resolves to true only if A and B are the same type. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/**
 * Resolves to true only if every A is a B, and A has no field that B does
 * not. TypeScript alone lets an object type with extra fields pass for one
 * without them.
 */
type Accepted<A, B> = [A] extends [B]
  ? [Exclude<keyof A, keyof B>] extends [never]
    ? true
    : false
  : false;
/** A compile error unless the check resolved to true. */
type Holds<T extends true> = T;

export type Responses = [
  Holds<Same<auth.AccountResponse, Schema["AccountResponse"]>>,
  Holds<Same<auth.MessageResponse, Schema["MessageResponse"]>>,
  Holds<Same<posts.PostAuthorResponse, Schema["PostAuthorResponse"]>>,
  Holds<Same<posts.PostResponse, Schema["PostResponse"]>>,
  Holds<Same<posts.PostPageResponse, Schema["PostPageResponse"]>>,
  Holds<Same<posts.LikeResponse, Schema["LikeResponse"]>>,
  Holds<Same<posts.RepostResponse, Schema["RepostResponse"]>>,
  Holds<Same<profiles.PublicProfileResponse, Schema["PublicProfileResponse"]>>,
  Holds<Same<profiles.MyProfileResponse, Schema["MyProfileResponse"]>>,
  Holds<Same<profiles.FollowResponse, Schema["FollowResponse"]>>,
  Holds<Same<sessions.SessionResponse, Schema["SessionResponse"]>>,
  Holds<Same<sessions.RevokedSessionsResponse, Schema["RevokedSessionsResponse"]>>,
];

export type Requests = [
  Holds<Accepted<auth.RegisterRequest, Schema["RegisterRequest"]>>,
  Holds<Accepted<auth.LoginRequest, Schema["LoginRequest"]>>,
  Holds<Accepted<auth.ChangePasswordRequest, Schema["ChangePasswordRequest"]>>,
  Holds<Accepted<auth.DeleteAccountRequest, Schema["DeleteAccountRequest"]>>,
  Holds<Accepted<posts.CreatePostRequest, Schema["CreatePostRequest"]>>,
  Holds<Accepted<posts.UpdatePostRequest, Schema["UpdatePostRequest"]>>,
  Holds<Accepted<profiles.UpdateProfileRequest, Schema["UpdateProfileRequest"]>>,
  Holds<Accepted<exporting.ExportRequest, Schema["ExportRequest"]>>,
];
