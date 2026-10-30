/* Holds the hand-written API types to lib/api-schema.d.ts at compile time. */

import type { components } from "./api-schema";
import type * as auth from "./auth";
import type * as exporting from "./export";
import type * as posts from "./posts";
import type * as profiles from "./profiles";
import type * as sessions from "./sessions";
import type * as stories from "./stories";

type Schema = components["schemas"];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Every A is a B with no extra field, which TypeScript alone would let pass. */
type Accepted<A, B> = [A] extends [B]
  ? [Exclude<keyof A, keyof B>] extends [never]
    ? true
    : false
  : false;
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
  Holds<Same<stories.StoryAuthorResponse, Schema["StoryAuthorResponse"]>>,
  Holds<Same<stories.StoryResponse, Schema["StoryResponse"]>>,
  Holds<Same<stories.StoryPageResponse, Schema["StoryPageResponse"]>>,
  Holds<Same<stories.StoryViewResponse, Schema["StoryViewResponse"]>>,
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
