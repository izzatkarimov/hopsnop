"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { profileHref } from "@/components/posts/post-item";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/text-field";
import { unexpectedErrorMessage } from "@/lib/api";
import { isUsername } from "@/lib/auth-validation";
import { formatCount } from "@/lib/format";
import { getPublicProfile } from "@/lib/profiles";
import type { PublicProfile } from "@/lib/types";

/** How long typing has to pause before the username is looked up. */
const LOOKUP_DELAY_MS = 400;

type Lookup =
  | { status: "idle" }
  | { status: "loading"; username: string }
  | { status: "found"; profile: PublicProfile }
  | { status: "missing"; username: string }
  | { status: "error"; username: string; message: string };

type Query =
  /** A username to look up, in the form the backend stores it. */
  | { username: string }
  /** Nothing to look up. `problem` says why, or is null while still typing. */
  | { username: null; problem: string | null };

/**
 * What the text in the field asks for. The rules are the backend's for a
 * username (app/schemas/auth.py), which ignores case and surrounding spaces.
 * A leading "@" is allowed, since usernames are shown with one.
 */
function queryFrom(text: string, { submitted }: { submitted: boolean }): Query {
  const value = text.trim().replace(/^@/, "");
  if (value === "") return { username: null, problem: null };
  if (/[^A-Za-z0-9_]/.test(value)) {
    return {
      username: null,
      problem:
        "Usernames have only letters, numbers and underscores. Searching by name isn't available yet.",
    };
  }
  if (value.length > 30) {
    return { username: null, problem: "Usernames have at most 30 characters." };
  }
  if (!isUsername(value)) {
    // Too short for any account. Only said once the user asks for it.
    return {
      username: null,
      problem: submitted ? "Usernames have at least 3 characters." : null,
    };
  }
  return { username: value.toLowerCase() };
}

/**
 * Finds an account by its exact username, with GET /users/{username}. The
 * backend has no search: no lookup by name or by part of a username, and
 * none for posts. So this says that it looks up exact usernames, and
 * nothing more.
 *
 * The username is looked up once typing pauses, or at once on Enter. Only
 * the answer for the latest username is ever shown, and a username whose
 * answer is shown or on its way is not asked for again.
 */
export function UserLookup() {
  const auth = useAuth();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  // Said to screen readers when an answer is shown.
  const [announcement, setAnnouncement] = useState("");
  // Numbers the lookups. An answer is only shown if no lookup was started,
  // and nothing else typed, after the one it answers.
  const latest = useRef(0);
  // The username whose answer is shown or on its way.
  const current = useRef<string | null>(null);
  // The lookup that waits for typing to pause.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const headingId = useId();

  // A lookup still waiting for typing to pause is not sent once the page
  // has been left.
  useEffect(() => () => clearTimeout(timer.current), []);

  async function lookUp(username: string) {
    clearTimeout(timer.current);
    const lookupId = ++latest.current;
    current.current = username;
    setLookup({ status: "loading", username });
    setAnnouncement("");

    try {
      const profile = await getPublicProfile(username);
      if (lookupId !== latest.current) return;
      if (profile) {
        setLookup({ status: "found", profile });
        setAnnouncement(`Found ${profile.displayName}, @${profile.username}.`);
      } else {
        setLookup({ status: "missing", username });
        setAnnouncement(`No account is called @${username}.`);
      }
    } catch (error) {
      if (lookupId !== latest.current) return;
      // Not an answer for this username, so it may be asked for again.
      current.current = null;
      setLookup({ status: "error", username, message: unexpectedErrorMessage(error) });
    }
  }

  function handleChange(value: string) {
    setText(value);
    clearTimeout(timer.current);
    const query = queryFrom(value, { submitted: false });

    if (query.username === null) {
      // Whatever was on its way is not an answer to what is there now.
      latest.current++;
      current.current = null;
      setProblem(query.problem);
      setLookup({ status: "idle" });
      setAnnouncement("");
      return;
    }

    setProblem(null);
    // E.g. only the case or a space changed.
    if (query.username === current.current) return;

    latest.current++;
    current.current = null;
    setLookup({ status: "loading", username: query.username });
    setAnnouncement("");
    const { username } = query;
    timer.current = setTimeout(() => lookUp(username), LOOKUP_DELAY_MS);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = queryFrom(text, { submitted: true });
    if (query.username === null) {
      setProblem(query.problem);
      return;
    }
    // At once, without waiting for typing to pause.
    if (query.username !== current.current) lookUp(query.username);
  }

  let result: ReactNode = null;
  if (lookup.status === "loading") {
    result = <LookupSkeleton />;
  } else if (lookup.status === "found") {
    const isViewer =
      auth.status === "authenticated" && auth.user.id === lookup.profile.id;
    result = <AccountRow profile={lookup.profile} isViewer={isViewer} />;
  } else if (lookup.status === "missing") {
    result = (
      <EmptyState
        title={`No account is called @${lookup.username}`}
        description="Check the spelling. The whole username is needed, not just the start of it."
      />
    );
  } else if (lookup.status === "error") {
    const { username, message } = lookup;
    result = (
      <div role="alert">
        <EmptyState
          title={`Couldn't look up @${username}`}
          description={message}
          action={
            <button
              type="button"
              onClick={() => lookUp(username)}
              className="rounded-full bg-accent px-5 py-2 font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <form
        role="search"
        aria-labelledby={headingId}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 border-b border-border px-4 py-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-lg font-semibold">
            Find people
          </h2>
          <p className="text-body text-muted">
            Look someone up by their exact username. Searching by name, and
            searching posts, isn&apos;t available yet. The newest posts from
            everyone are under{" "}
            <Link href="/" className="font-medium text-accent hover:underline">
              For you on Home
            </Link>
            .
          </p>
        </div>
        <TextField
          label="Username"
          type="search"
          name="username"
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          hint="For example alice_92. The account appears as you type, or press Enter."
          error={problem}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </form>

      <div aria-busy={lookup.status === "loading"}>{result}</div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

type AccountRowProps = {
  profile: PublicProfile;
  /** The account is the signed-in user's own. */
  isViewer: boolean;
};

/** The account that was found, linking to its profile. */
function AccountRow({ profile, isViewer }: AccountRowProps) {
  const href = profileHref(profile.username);
  const marker = isViewer ? "You" : profile.followedByViewer ? "Following" : null;

  return (
    <div className="flex gap-3 border-b border-border px-4 py-3">
      {/* The same link as the name, for the pointer only: keyboard and
          screen reader users reach the profile once, by name. */}
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        className="shrink-0 self-start rounded-full"
      >
        <Avatar user={profile} />
      </Link>

      <div className="min-w-0 flex-1 text-body">
        <div className="flex items-start justify-between gap-3">
          <Link href={href} className="group flex min-w-0 flex-col">
            <span className="truncate font-semibold group-hover:underline">
              {profile.displayName}
            </span>
            <span className="truncate text-muted">@{profile.username}</span>
          </Link>
          {marker && (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
              {marker}
            </span>
          )}
        </div>

        {profile.bio && (
          // Written by the user, so it is only ever rendered as text.
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap wrap-break-word">
            {profile.bio}
          </p>
        )}

        <p className="mt-1 flex gap-4 text-muted">
          <span>
            <span className="font-semibold text-foreground tabular-nums">
              {formatCount(profile.followingCount)}
            </span>{" "}
            Following
          </span>
          <span>
            <span className="font-semibold text-foreground tabular-nums">
              {formatCount(profile.followersCount)}
            </span>{" "}
            {profile.followersCount === 1 ? "Follower" : "Followers"}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Placeholder shown while a username is being looked up. */
function LookupSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex animate-pulse gap-3 border-b border-border px-4 py-3"
    >
      <div className="size-10 shrink-0 rounded-full bg-hover" />
      <div className="flex flex-1 flex-col gap-2.5 pt-1">
        <div className="h-3 w-1/3 rounded bg-hover" />
        <div className="h-3 w-1/4 rounded bg-hover" />
      </div>
    </div>
  );
}
