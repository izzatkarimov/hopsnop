"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { unexpectedErrorMessage } from "@/lib/api";
import { getPublicProfile } from "@/lib/profiles";
import type { PublicProfile as PublicProfileData } from "@/lib/types";
import { FollowButton } from "./follow-button";
import { ProfileHeader } from "./profile-header";
import { ProfilePosts } from "./profile-posts";
import { ProfileSkeleton } from "./profile-skeleton";

type State =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: PublicProfileData };

/**
 * Any user's profile as the public may see it, loaded from
 * GET /users/{username}. Works with or without a session.
 *
 * What is shown is what that endpoint returns, and it returns public fields
 * only. Nothing here decides what a viewer is allowed to see.
 */
export function PublicProfile({ username }: { username: string }) {
  const auth = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Counts follow changes, so that a profile read after an earlier one
  // cannot replace what a later one has shown.
  const latestFollowChange = useRef(0);

  useEffect(() => {
    // Set by the cleanup, so that a request this effect no longer cares
    // about cannot change the state.
    let ignore = false;

    getPublicProfile(username).then(
      (profile) => {
        if (ignore) return;
        setState(
          profile ? { status: "ready", profile } : { status: "not_found" },
        );
      },
      (error: unknown) => {
        if (ignore) return;
        setState({ status: "error", message: unexpectedErrorMessage(error) });
      },
    );

    return () => {
      ignore = true;
    };
  }, [username, attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  async function handleFollowChange(followedByViewer: boolean) {
    const change = ++latestFollowChange.current;
    setState((current) =>
      current.status === "ready"
        ? { ...current, profile: { ...current.profile, followedByViewer } }
        : current,
    );
    // The follow answer has no counts in it, so the profile is read again
    // for them. If that fails the counts shown stay the last ones the
    // backend gave; none is worked out here.
    try {
      const profile = await getPublicProfile(username);
      if (!profile || latestFollowChange.current !== change) return;
      setState((current) =>
        current.status === "ready" ? { status: "ready", profile } : current,
      );
    } catch (error) {
      console.warn("Could not refresh the profile after a follow change.", error);
    }
  }

  if (state.status === "loading") {
    return <ProfileSkeleton />;
  }

  if (state.status === "not_found") {
    return (
      <EmptyState
        title="Profile not found"
        description="This account doesn't exist or isn't available."
      />
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert">
        <EmptyState
          title="Couldn't load this profile"
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

  const { profile } = state;
  const isOwnProfile =
    auth.status === "authenticated" && auth.user.id === profile.id;

  return (
    <>
      <ProfileHeader
        profile={profile}
        action={
          // Only a shortcut. Editing happens on /profile, and the backend
          // decides whose profile a request may change.
          isOwnProfile ? (
            <Link
              href="/profile"
              className="rounded-full border border-border px-4 py-1.5 text-body font-semibold transition-colors hover:bg-hover"
            >
              Edit profile
            </Link>
          ) : (
            // Following needs a session; a visitor without one is not asked.
            auth.status === "authenticated" && (
              <FollowButton
                username={profile.username}
                following={profile.followedByViewer}
                onChange={handleFollowChange}
              />
            )
          )
        }
      />
      <ProfilePosts
        username={profile.username}
        displayName={profile.displayName}
      />
    </>
  );
}
