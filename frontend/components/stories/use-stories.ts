"use client";

import { useEffect, useReducer, useRef } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import * as storiesApi from "@/lib/stories";
import { groupStories } from "@/lib/stories";
import type { StoryGroup } from "@/lib/stories";
import type { Story } from "@/lib/types";

/** The longest wait setTimeout keeps, about 24.8 days. */
const MAX_TIMEOUT_MS = 2_147_483_647;

type State = {
  viewer: string;
  status: "loading" | "error" | "ready";
  /** Counts load attempts, so a retry loads it again. */
  attempt: number;
  stories: Story[];
  written: Story[];
  current: string | null;
  /** Counts every move, so showing a story again restarts it. */
  step: number;
  announcement: string;
};

type Action =
  | { type: "load" }
  | { type: "loaded"; stories: Story[]; now: number }
  | { type: "failed" }
  | { type: "published"; story: Story }
  | { type: "viewed"; id: string; viewed: boolean }
  | { type: "removed"; ids: string[]; announcement?: string }
  | { type: "expired"; now: number }
  | { type: "open"; username: string }
  | { type: "next" }
  | { type: "previous" }
  | { type: "close" };

function initialState(viewer: string): State {
  return {
    viewer,
    status: "loading",
    attempt: 0,
    stories: [],
    written: [],
    current: null,
    step: 0,
    announcement: "",
  };
}

function isActive(story: Story, now: number): boolean {
  return Date.parse(story.expiresAt) > now;
}

function merge(first: Story[], then: Story[]): Story[] {
  const known = new Set(first.map((story) => story.id));
  return [...first, ...then.filter((story) => !known.has(story.id))];
}

function startOf(group: StoryGroup): string {
  const unviewed = group.isOwn
    ? undefined
    : group.stories.find((story) => !story.viewedByViewer);
  return (unviewed ?? group.stories[0]).id;
}

function locate(groups: StoryGroup[], id: string) {
  for (let group = 0; group < groups.length; group++) {
    const index = groups[group].stories.findIndex((story) => story.id === id);
    if (index !== -1) return { group, index };
  }
  return null;
}

function following(
  groups: StoryGroup[],
  id: string,
  remaining: StoryGroup[],
  gone: ReadonlySet<string> = new Set(),
): string | null {
  const at = locate(groups, id);
  if (!at) return null;

  const later = groups[at.group].stories
    .slice(at.index + 1)
    .find((story) => !gone.has(story.id));
  if (later) return later.id;

  for (const group of groups.slice(at.group + 1)) {
    const left = remaining.find(
      (other) => other.author.username === group.author.username,
    );
    if (left) return startOf(left);
  }
  return null;
}

function preceding(groups: StoryGroup[], id: string): string {
  const at = locate(groups, id);
  if (!at) return id;
  if (at.index > 0) return groups[at.group].stories[at.index - 1].id;
  if (at.group === 0) return id;
  const before = groups[at.group - 1].stories;
  return before[before.length - 1].id;
}

function remove(state: State, ids: string[], announcement?: string): State {
  const gone = new Set(ids);
  const stories = state.stories.filter((story) => !gone.has(story.id));
  let { current, step } = state;
  if (current !== null && gone.has(current)) {
    current = following(
      groupStories(state.stories, state.viewer),
      current,
      groupStories(stories, state.viewer),
      gone,
    );
    step++;
  }
  return {
    ...state,
    stories,
    written: state.written.filter((story) => !gone.has(story.id)),
    current,
    step,
    announcement: announcement ?? state.announcement,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "load":
      return { ...state, status: "loading", attempt: state.attempt + 1 };
    case "loaded":
      return {
        ...state,
        status: "ready",
        stories: merge(state.written, action.stories).filter((story) =>
          isActive(story, action.now),
        ),
      };
    case "failed":
      return { ...state, status: "error" };
    case "published":
      return {
        ...state,
        written: [action.story, ...state.written],
        stories: merge([action.story], state.stories),
        announcement: "Your story was published.",
      };
    case "viewed":
      return {
        ...state,
        stories: state.stories.map((story) =>
          story.id === action.id ? { ...story, viewedByViewer: action.viewed } : story,
        ),
      };
    case "removed":
      return remove(state, action.ids, action.announcement);
    case "expired": {
      const expired = state.stories
        .filter((story) => !isActive(story, action.now))
        .map((story) => story.id);
      return expired.length > 0 ? remove(state, expired) : state;
    }
    case "open": {
      const group = groupStories(state.stories, state.viewer).find(
        (candidate) => candidate.author.username === action.username,
      );
      if (!group) return state;
      return { ...state, current: startOf(group), step: state.step + 1, announcement: "" };
    }
    case "next": {
      if (state.current === null) return state;
      const groups = groupStories(state.stories, state.viewer);
      return { ...state, current: following(groups, state.current, groups), step: state.step + 1 };
    }
    case "previous": {
      if (state.current === null) return state;
      const groups = groupStories(state.stories, state.viewer);
      return { ...state, current: preceding(groups, state.current), step: state.step + 1 };
    }
    case "close":
      return { ...state, current: null, announcement: "" };
  }
}

export type Viewing = { group: StoryGroup; story: Story };

export function useStories(viewerUsername: string) {
  const { expireSession } = useAuth();
  const [state, dispatch] = useReducer(reducer, viewerUsername, initialState);
  // A ref, so a view is sent once even if the picture reloads before React renders.
  const viewsSent = useRef(new Set<string>());

  useEffect(() => {
    let ignore = false;
    storiesApi.listStories().then(
      (stories) => {
        if (!ignore) dispatch({ type: "loaded", stories, now: Date.now() });
      },
      (error: unknown) => {
        if (ignore) return;
        if (isApiError(error) && error.kind === "unauthenticated") expireSession();
        dispatch({ type: "failed" });
      },
    );
    return () => {
      ignore = true;
    };
  }, [state.attempt, expireSession]);

  // Taken out as it expires, by this device's clock.
  useEffect(() => {
    if (state.stories.length === 0) return;
    const soonest = Math.min(...state.stories.map((story) => Date.parse(story.expiresAt)));
    const timer = setTimeout(
      () => dispatch({ type: "expired", now: Date.now() }),
      Math.min(Math.max(0, soonest - Date.now()), MAX_TIMEOUT_MS),
    );
    return () => clearTimeout(timer);
  }, [state.stories]);

  function handleAuthError(error: unknown): boolean {
    if (isApiError(error) && error.kind === "unauthenticated") {
      expireSession();
      return true;
    }
    return false;
  }

  async function recordView(story: Story) {
    if (
      story.author.username === viewerUsername ||
      story.viewedByViewer ||
      viewsSent.current.has(story.id)
    ) {
      return;
    }
    viewsSent.current.add(story.id);
    try {
      const viewed = await storiesApi.recordStoryView(story.id);
      dispatch({ type: "viewed", id: story.id, viewed });
    } catch (error) {
      if (isApiError(error) && error.kind === "not_found") {
        dispatch({ type: "removed", ids: [story.id] });
        return;
      }
      handleAuthError(error);
      // Not recorded, so it's asked for again when next shown.
      viewsSent.current.delete(story.id);
    }
  }

  /** Resolves with why it couldn't be deleted, or null once it's gone. */
  async function deleteStory(story: Story): Promise<string | null> {
    try {
      await storiesApi.deleteStory(story.id);
      dispatch({ type: "removed", ids: [story.id], announcement: "Your story was deleted." });
      return null;
    } catch (error) {
      if (handleAuthError(error)) return null;
      if (isApiError(error) && error.kind === "not_found") {
        dispatch({ type: "removed", ids: [story.id] });
        return null;
      }
      return isApiError(error) && error.kind === "forbidden"
        ? "You're not allowed to delete this story."
        : unexpectedErrorMessage(error);
    }
  }

  async function checkStory(story: Story): Promise<boolean> {
    try {
      if (await storiesApi.getStory(story.id)) return true;
      dispatch({ type: "removed", ids: [story.id] });
      return false;
    } catch (error) {
      handleAuthError(error);
      return true;
    }
  }

  const groups = groupStories(state.stories, viewerUsername);
  let viewing: Viewing | null = null;
  for (const group of groups) {
    const story = group.stories.find((candidate) => candidate.id === state.current);
    if (story) viewing = { group, story };
  }

  return {
    status: state.status,
    groups,
    viewing,
    step: state.step,
    announcement: state.announcement,
    retry: () => dispatch({ type: "load" }),
    add: (story: Story) => dispatch({ type: "published", story }),
    open: (username: string) => dispatch({ type: "open", username }),
    next: () => dispatch({ type: "next" }),
    previous: () => dispatch({ type: "previous" }),
    close: () => dispatch({ type: "close" }),
    recordView,
    deleteStory,
    checkStory,
  };
}
