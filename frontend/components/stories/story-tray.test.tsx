import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/auth/require-auth";
import { api, deferred, json } from "@/test/api";
import type { Reply } from "@/test/api";
import { alice, bob, story, storyPage, viewerAuthor } from "@/test/fixtures";
import { authState, renderSignedIn } from "@/test/render";
import { StoryTray } from "./story-tray";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const LIST = "/stories?limit=50";

async function setup(...replies: Reply[]) {
  api.on("GET", LIST, ...replies);
  await renderSignedIn(
    <RequireAuth>
      <StoryTray />
    </RequireAuth>,
  );
  return { user: userEvent.setup() };
}

function tray() {
  return screen.getByRole("region", { name: "Stories" });
}

function entries(): (string | null)[] {
  return within(tray())
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
}

function ringOf(name: string) {
  return screen.getByRole("button", { name }).querySelector("span");
}

describe("StoryTray", () => {
  it("shows a placeholder, then each author once: one's own first, the others by their newest story", async () => {
    const list = deferred();
    await setup(list.reply);

    expect(screen.getByText("Loading stories…")).toBeInTheDocument();
    expect(entries()).toEqual(["Add a story"]);

    await act(() =>
      list.respond(
        json(200, storyPage([story(1, bob), story(2, alice), story(3, viewerAuthor), story(4, bob)])),
      ),
    );

    expect(entries()).toEqual([
      "Your story",
      "Add a story",
      "Stories by Bob Example, new",
      "Stories by Alice Example, new",
    ]);
    expect(screen.queryByText("Loading stories…")).not.toBeInTheDocument();
  });

  it("rings an author with new stories differently from one whose stories are all seen", async () => {
    await setup(
      json(200, storyPage([story(1, alice), story(2, bob, { viewed_by_me: true }), story(3, alice, { viewed_by_me: true })])),
    );

    expect(await screen.findByRole("button", { name: "Stories by Alice Example, new" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stories by Bob Example, all seen" })).toBeInTheDocument();
    expect(ringOf("Stories by Alice Example, new")).toHaveClass("border-accent");
    expect(ringOf("Stories by Bob Example, all seen")).toHaveClass("border-border");
    expect(ringOf("Stories by Bob Example, all seen")).not.toHaveClass("border-accent");
  });

  it("shows only the add button, without a ring, when nobody has a story", async () => {
    await setup(json(200, storyPage([])));

    await waitFor(() => expect(screen.queryByText("Loading stories…")).not.toBeInTheDocument());
    expect(entries()).toEqual(["Add a story"]);
    expect(within(tray()).queryByRole("button", { name: "Your story" })).not.toBeInTheDocument();
    expect(tray().querySelector(".border-accent")).toBeNull();
  });

  it("gives one's own stories a button of their own next to the add button", async () => {
    await setup(json(200, storyPage([story(1, viewerAuthor)])));

    expect(await screen.findByRole("button", { name: "Your story" })).toBeInTheDocument();
    expect(ringOf("Your story")).toHaveClass("border-accent");
    expect(screen.getByRole("button", { name: "Add a story" })).toBeInTheDocument();
  });

  it("says when the stories could not be loaded, and loads them again on request", async () => {
    const { user } = await setup(json(503, { detail: "Unavailable." }), json(200, storyPage([story(1, alice)])));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load stories.");
    expect(screen.getByRole("button", { name: "Add a story" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Stories by Alice Example, new" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.calls("GET", LIST)).toHaveLength(2);
  });

  it("ends the session when the API no longer has one", async () => {
    await setup(json(401, { detail: "Not authenticated." }));

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });

  it("leaves out a story that has expired by this device's clock", async () => {
    const expired = story(2, bob, { expires_at: new Date(Date.now() - 1000).toISOString() });
    await setup(json(200, storyPage([story(1, alice), expired])));

    expect(await screen.findByRole("button", { name: "Stories by Alice Example, new" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bob Example/ })).not.toBeInTheDocument();
  });

  it("takes a story out at the moment it expires", async () => {
    const list = deferred();
    await setup(list.reply);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const soon = story(2, bob, { expires_at: new Date(Date.now() + 60_000).toISOString() });
    await act(() => list.respond(json(200, storyPage([story(1, alice), soon]))));
    expect(screen.getByRole("button", { name: "Stories by Bob Example, new" })).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(59_000));
    expect(screen.getByRole("button", { name: "Stories by Bob Example, new" })).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.queryByRole("button", { name: /Bob Example/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stories by Alice Example, new" })).toBeInTheDocument();
  });
});
