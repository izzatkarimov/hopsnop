"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { getCurrentProfile } from "@/lib/profiles";
import type { Profile } from "@/lib/types";
import { EditProfileForm } from "./edit-profile-form";
import { ProfileHeader } from "./profile-header";
import { ProfilePosts } from "./profile-posts";
import { ProfileSkeleton } from "./profile-skeleton";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: Profile };

/**
 * The signed-in user's own profile, loaded from GET /users/me, with a way
 * to edit it. The profile lives in this component: it is page data, not
 * part of the auth state.
 */
export function OwnProfile() {
  const { updateUser, expireSession } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    // Set by the cleanup, so that a request this effect no longer cares
    // about (the page was left, or a retry started) cannot change the state.
    let ignore = false;

    getCurrentProfile().then(
      (profile) => {
        if (!ignore) setState({ status: "ready", profile });
      },
      (error: unknown) => {
        if (ignore) return;
        if (isApiError(error) && error.kind === "unauthenticated") {
          // The session is gone. RequireAuth leads to the login page.
          expireSession();
          return;
        }
        setState({ status: "error", message: unexpectedErrorMessage(error) });
      },
    );

    return () => {
      ignore = true;
    };
  }, [attempt, expireSession]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  function handleSaved(profile: Profile) {
    // The response is the saved profile, so nothing needs to be fetched again.
    setState({ status: "ready", profile });
    setEditing(false);
    setAnnouncement("Profile updated.");
    // The sidebar and the composer show the same name and picture.
    updateUser({
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    });
  }

  if (state.status === "loading") {
    return <ProfileSkeleton />;
  }

  if (state.status === "error") {
    return (
      <div role="alert">
        <EmptyState
          title="Couldn't load your profile"
          description={state.message}
          action={
            <button
              type="button"
              onClick={retry}
              className="rounded-full bg-accent px-5 py-2 font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  if (editing) {
    return (
      <EditProfileForm
        profile={state.profile}
        onSaved={handleSaved}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <>
      <ProfileHeader
        profile={state.profile}
        action={
          <button
            type="button"
            onClick={() => {
              setAnnouncement("");
              setEditing(true);
            }}
            className="rounded-full border border-border px-4 py-1.5 text-body font-semibold transition-colors hover:bg-hover"
          >
            Edit profile
          </button>
        }
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <ProfilePosts
        username={state.profile.username}
        displayName={state.profile.displayName}
      />
    </>
  );
}
