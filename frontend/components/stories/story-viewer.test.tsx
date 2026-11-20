import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/auth/require-auth";
import type { StoryResponse } from "@/lib/stories";
import { API_URL, api, deferred, json, noContent } from "@/test/api";
import { alice, bob, story, storyId, storyPage, viewerAuthor } from "@/test/fixtures";
import type { PostAuthorResponse } from "@/lib/posts";
import { authState, renderSignedIn } from "@/test/render";
import { StoryTray } from "./story-tray";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const LIST = "/stories?limit=50";
const ALICE = "Stories by Alice Example, new";

const carol: PostAuthorResponse = {
  id: "ca201000-0000-4000-8000-000000000003",
  username: "carol_5",
  display_name: "Carol Example",
  avatar_url: null,
};

function render() {
  return renderSignedIn(
    <RequireAuth>
      <StoryTray />
    </RequireAuth>,
  );
}

async function setup(stories: StoryResponse[]) {
  api.on("GET", LIST, json(200, storyPage(stories)));
  await render();
  await waitFor(() => expect(screen.queryByText("Loading stories…")).not.toBeInTheDocument());
  return { user: userEvent.setup() };
}

function stopTime() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
}

async function pass(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

async function settle() {
  await act(() => new Promise((resolve) => setImmediate(resolve)));
}

function viewer() {
  return screen.getByRole("dialog");
}

function picture() {
  return within(viewer()).getByRole("img", { name: /^Story by / });
}

function shownStory(): number {
  const source = picture().getAttribute("src") ?? "";
  return Number(/(\d{12})\/media$/.exec(source)?.[1]);
}

function button(name: string) {
  return within(viewer()).getByRole("button", { name });
}

function viewPath(n: number) {
  return `/stories/${storyId(n)}/view`;
}

function progressBar() {
  return viewer().querySelector(".animate-story-progress");
}

function neighbour(side: "previous" | "next") {
  return screen.getByTestId(`story-${side}-author`);
}

/** Through the ⋯ menu, which only one's own stories have. */
async function askToDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(button("Story options"));
  const menu = within(viewer()).getByRole("menu", { name: "Story options" });
  await user.click(within(menu).getByRole("menuitem", { name: "Delete story" }));
  return within(viewer()).getByRole("group", { name: "Delete this story?" });
}

async function deleteIt(user: ReturnType<typeof userEvent.setup>) {
  const confirmation = await askToDelete(user);
  await user.click(within(confirmation).getByRole("button", { name: "Delete" }));
}

describe("StoryViewer: what it shows", () => {
  it("opens an author's stories at the first one not viewed yet, and plays them oldest first", async () => {
    const { user } = await setup([story(1, alice), story(2, alice), story(3, alice, { viewed_by_me: true })]);

    await user.click(screen.getByRole("button", { name: ALICE }));

    expect(viewer()).toHaveAccessibleName("Stories by Alice Example");
    expect(shownStory()).toBe(2);
    expect(within(viewer()).getByText("Story 2 of 3")).toBeInTheDocument();
    await user.click(button("Next"));
    expect(shownStory()).toBe(1);
  });

  it.each([
    [
      "someone whose stories are all seen",
      [story(1, alice, { viewed_by_me: true }), story(2, alice, { viewed_by_me: true })],
      "Stories by Alice Example, all seen",
    ],
    ["one's own", [story(1, viewerAuthor), story(2, viewerAuthor)], "Your story"],
  ])("starts the stories of %s at the oldest", async (_, stories, name) => {
    const { user } = await setup(stories);

    await user.click(screen.getByRole("button", { name }));

    expect(shownStory()).toBe(2);
  });

  it("shows the picture from the API at its size, the author, the time and the caption as plain text", async () => {
    const created = Date.now() - 3 * 60 * 60_000;
    const { user } = await setup([
      story(1, alice, {
        created_at: new Date(created).toISOString(),
        expires_at: new Date(created + 24 * 60 * 60_000).toISOString(),
        caption: "<b>Good morning</b>",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: ALICE }));

    expect(picture()).toHaveAttribute("src", `${API_URL}/stories/${storyId(1)}/media`);
    expect(picture()).toHaveAttribute("width", "1080");
    expect(picture()).toHaveAttribute("height", "1440");
    expect(within(viewer()).getByRole("link", { name: "Alice Example" })).toHaveAttribute(
      "href",
      "/users/alice_92",
    );
    expect(within(viewer()).getByText("3h")).toBeInTheDocument();
    expect(within(viewer()).getByText("<b>Good morning</b>")).toBeInTheDocument();
    expect(viewer().querySelector("b")).toBeNull();
  });
});

describe("StoryViewer: moving between stories", () => {
  it("moves with the arrow keys from one author to the next and back, and closes with Esc", async () => {
    const { user } = await setup([story(1, bob), story(2, alice), story(3, alice)]);
    const opener = screen.getByRole("button", { name: "Stories by Bob Example, new" });

    await user.click(opener);
    expect(shownStory()).toBe(1);

    await user.keyboard("{ArrowRight}");
    expect(viewer()).toHaveAccessibleName("Stories by Alice Example");
    expect(shownStory()).toBe(3);
    await user.keyboard("{ArrowRight}");
    expect(shownStory()).toBe(2);
    await user.keyboard("{ArrowLeft}");
    expect(shownStory()).toBe(3);
    await user.keyboard("{ArrowLeft}");
    expect(viewer()).toHaveAccessibleName("Stories by Bob Example");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("moves with the outer thirds of the picture and with the Previous and Next buttons", async () => {
    const { user } = await setup([story(1, alice), story(2, alice), story(3, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    expect(shownStory()).toBe(3);

    await user.click(screen.getByTestId("story-next-area"));
    expect(shownStory()).toBe(2);
    await user.click(screen.getByTestId("story-previous-area"));
    expect(shownStory()).toBe(3);
    await user.click(button("Next"));
    expect(shownStory()).toBe(2);
    await user.click(button("Previous"));
    expect(shownStory()).toBe(3);
  });

  it("closes with the Close button, and after the last story", async () => {
    const { user } = await setup([story(1, alice)]);
    const opener = screen.getByRole("button", { name: ALICE });

    await user.click(opener);
    await user.click(button("Close"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.click(button("Next"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("StoryViewer: moving on by itself", () => {
  it("goes on 5 seconds after the picture has loaded, to the next author, and closes after the last", async () => {
    api.on("POST", viewPath(1), json(200, { viewed: true }));
    api.on("POST", viewPath(2), json(200, { viewed: true }));
    const { user } = await setup([story(1, alice), story(2, bob)]);
    const opener = screen.getByRole("button", { name: ALICE });
    await user.click(opener);
    stopTime();

    await pass(10_000);
    expect(shownStory()).toBe(1);
    expect(progressBar()).toBeNull();

    fireEvent.load(picture());
    expect(progressBar()).not.toBeNull();
    await pass(4_000);
    expect(shownStory()).toBe(1);
    await pass(1_000);
    expect(viewer()).toHaveAccessibleName("Stories by Bob Example");

    fireEvent.load(picture());
    await pass(5_000);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("pauses while the picture is pressed, stopping its progress bar, and a long press does not move on", async () => {
    const { user } = await setup([story(1, alice), story(2, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    stopTime();
    api.on("POST", viewPath(2), json(200, { viewed: true }));
    fireEvent.load(picture());
    const half = screen.getByTestId("story-next-area");
    expect(progressBar()).not.toHaveClass("[animation-play-state:paused]");

    fireEvent.pointerDown(half);
    expect(progressBar()).toHaveClass("[animation-play-state:paused]");
    await pass(8_000);
    expect(shownStory()).toBe(2);

    fireEvent.pointerUp(half);
    fireEvent.click(half);
    expect(shownStory()).toBe(2);
    expect(progressBar()).not.toHaveClass("[animation-play-state:paused]");

    await pass(5_000);
    expect(shownStory()).toBe(1);
  });

  it("pauses with the Pause button until it is pressed again, even on the next story", async () => {
    const { user } = await setup([story(1, alice), story(2, alice), story(3, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    stopTime();
    api.on("POST", viewPath(3), json(200, { viewed: true }));
    api.on("POST", viewPath(2), json(200, { viewed: true }));
    fireEvent.load(picture());
    const pause = button("Pause");
    expect(pause).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(pause);
    expect(pause).toHaveAttribute("aria-pressed", "true");
    expect(progressBar()).toHaveClass("[animation-play-state:paused]");
    await pass(10_000);
    expect(shownStory()).toBe(3);

    fireEvent.click(button("Next"));
    fireEvent.load(picture());
    await pass(10_000);
    expect(shownStory()).toBe(2);
    expect(button("Pause")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button("Pause"));
    expect(button("Pause")).toHaveAttribute("aria-pressed", "false");
    await pass(5_000);
    expect(shownStory()).toBe(1);
  });

  it("pauses and goes on with Space, but leaves Space to a focused button", async () => {
    const { user } = await setup([story(1, alice), story(2, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    stopTime();
    api.on("POST", viewPath(2), json(200, { viewed: true }));
    fireEvent.load(picture());

    fireEvent.keyDown(viewer(), { key: " " });
    expect(button("Pause")).toHaveAttribute("aria-pressed", "true");
    await pass(10_000);
    expect(shownStory()).toBe(2);

    fireEvent.keyDown(button("Next"), { key: " " });
    expect(button("Pause")).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(viewer(), { key: " " });
    expect(button("Pause")).toHaveAttribute("aria-pressed", "false");
    await pass(5_000);
    expect(shownStory()).toBe(1);
  });

  it("goes on from where it was paused", async () => {
    const { user } = await setup([story(1, alice), story(2, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    stopTime();
    api.on("POST", viewPath(2), json(200, { viewed: true }));
    fireEvent.load(picture());
    const half = screen.getByTestId("story-next-area");

    await pass(3_000);
    fireEvent.pointerDown(half);
    await pass(10_000);
    fireEvent.pointerUp(half);
    fireEvent.click(half);

    await pass(1_900);
    expect(shownStory()).toBe(2);
    await pass(100);
    expect(shownStory()).toBe(1);
  });

  it("pauses while a control has focus from the keyboard, but not after a click", async () => {
    const { user } = await setup([story(1, alice), story(2, alice), story(3, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    await user.tab();
    expect(button("Previous")).toHaveFocus();
    stopTime();
    api.on("POST", viewPath(3), json(200, { viewed: true }));
    api.on("POST", viewPath(2), json(200, { viewed: true }));
    fireEvent.load(picture());

    await pass(8_000);
    expect(shownStory()).toBe(3);
    expect(progressBar()).toHaveClass("[animation-play-state:paused]");

    const next = button("Next");
    fireEvent.pointerDown(next);
    act(() => next.focus());
    fireEvent.click(next);
    expect(shownStory()).toBe(2);
    fireEvent.load(picture());
    await pass(5_000);
    expect(shownStory()).toBe(1);
  });

  it("does not move on by itself when less motion is preferred, and shows the bars without animation", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { user } = await setup([story(1, alice), story(2, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    stopTime();
    api.on("POST", viewPath(2), json(200, { viewed: true }));
    api.on("POST", viewPath(1), json(200, { viewed: true }));

    fireEvent.load(picture());
    fireEvent.keyDown(viewer(), { key: " " });
    await pass(20_000);

    expect(shownStory()).toBe(2);
    expect(progressBar()).toBeNull();
    expect(within(viewer()).queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    fireEvent.click(button("Next"));
    expect(shownStory()).toBe(1);
    fireEvent.click(button("Previous"));
    expect(shownStory()).toBe(2);
  });
});

describe("StoryViewer: views", () => {
  it("records a view of someone else's story once its picture has loaded, once, and shows it as seen", async () => {
    api.on("POST", viewPath(1), json(200, { viewed: true }));
    const { user } = await setup([story(1, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    expect(api.calls("POST")).toEqual([]);

    fireEvent.load(picture());
    fireEvent.load(picture());
    await waitFor(() => expect(api.calls("POST", viewPath(1))).toHaveLength(1));
    await user.keyboard("{Escape}");

    const seen = await screen.findByRole("button", { name: "Stories by Alice Example, all seen" });
    await user.click(seen);
    fireEvent.load(picture());
    await settle();
    expect(api.calls("POST")).toHaveLength(1);
  });

  it("never records a view of one's own story, nor of one already seen", async () => {
    const { user } = await setup([story(1, viewerAuthor), story(2, bob, { viewed_by_me: true })]);
    await user.click(screen.getByRole("button", { name: "Your story" }));

    fireEvent.load(picture());
    await user.keyboard("{ArrowRight}");
    expect(viewer()).toHaveAccessibleName("Stories by Bob Example");
    fireEvent.load(picture());
    await settle();

    expect(api.calls("POST")).toEqual([]);
  });

  it("takes a story out and moves on, without a word, when its view finds it gone", async () => {
    api.on("POST", viewPath(2), json(404, { detail: "Story not found." }));
    const { user } = await setup([story(1, alice), story(2, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    expect(shownStory()).toBe(2);

    fireEvent.load(picture());

    await waitFor(() => expect(shownStory()).toBe(1));
    expect(within(viewer()).getByText("Story 1 of 1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ends the session when a view finds it gone", async () => {
    api.on("POST", viewPath(1), json(401, { detail: "Not authenticated." }));
    const { user } = await setup([story(1, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));

    fireEvent.load(picture());

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});

describe("StoryViewer: one's own stories", () => {
  it("tells how many have seen one's own story, and nothing of the kind for others' stories", async () => {
    const { user } = await setup([story(1, viewerAuthor, { view_count: 3 }), story(2, alice)]);
    await user.click(screen.getByRole("button", { name: "Your story" }));

    expect(viewer()).toHaveAccessibleName("Your story");
    expect(within(viewer()).getByText("Seen by 3")).toBeInTheDocument();
    expect(button("Story options")).toBeInTheDocument();

    await user.keyboard("{ArrowRight}");
    expect(viewer()).toHaveAccessibleName("Stories by Alice Example");
    expect(within(viewer()).queryByText(/Seen by/)).not.toBeInTheDocument();
    expect(within(viewer()).queryByRole("button", { name: "Story options" })).not.toBeInTheDocument();
  });

  it("deletes one's own story after a confirmation, and moves on to the next", async () => {
    api.on("DELETE", `/stories/${storyId(2)}`, noContent());
    const { user } = await setup([story(1, viewerAuthor), story(2, viewerAuthor)]);
    await user.click(screen.getByRole("button", { name: "Your story" }));
    expect(shownStory()).toBe(2);

    await user.click(button("Story options"));
    const menu = within(viewer()).getByRole("menu", { name: "Story options" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Delete story"]);
    await user.keyboard("{Escape}");
    expect(within(viewer()).queryByRole("menu")).not.toBeInTheDocument();
    expect(button("Story options")).toHaveFocus();

    let confirmation = await askToDelete(user);
    expect(within(confirmation).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(within(viewer()).queryByRole("group")).not.toBeInTheDocument();
    expect(button("Story options")).toHaveFocus();

    confirmation = await askToDelete(user);
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(within(viewer()).queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(api.calls("DELETE")).toEqual([]);

    await deleteIt(user);

    await waitFor(() => expect(shownStory()).toBe(1));
    expect(api.calls("DELETE", `/stories/${storyId(2)}`)).toHaveLength(1);
    expect(within(viewer()).getByText("Story 1 of 1")).toBeInTheDocument();
    expect(within(viewer()).getByRole("status")).toHaveTextContent("Your story was deleted.");
  });

  it("closes after the last story is deleted, and gives focus to the add button", async () => {
    api.on("DELETE", `/stories/${storyId(1)}`, noContent());
    const { user } = await setup([story(1, viewerAuthor)]);
    await user.click(screen.getByRole("button", { name: "Your story" }));

    await deleteIt(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Your story" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a story" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Your story was deleted.");
  });

  it.each([
    ["a server error", json(500, { detail: "Internal server error." }), "Something went wrong. Please try again."],
    ["a refusal", json(403, { detail: "You are not the author of this story." }), "You're not allowed to delete this story."],
  ])("keeps the story and says why after %s", async (_, reply, message) => {
    api.on("DELETE", `/stories/${storyId(1)}`, reply);
    const { user } = await setup([story(1, viewerAuthor)]);
    await user.click(screen.getByRole("button", { name: "Your story" }));

    await deleteIt(user);

    expect(await within(viewer()).findByRole("alert")).toHaveTextContent(message);
    expect(shownStory()).toBe(1);
  });

  it("takes a story that is already gone out without a word", async () => {
    api.on("DELETE", `/stories/${storyId(1)}`, json(404, { detail: "Story not found." }));
    const { user } = await setup([story(1, viewerAuthor)]);
    await user.click(screen.getByRole("button", { name: "Your story" }));

    await deleteIt(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Your story" })).not.toBeInTheDocument();
  });

  it("ends the session when deleting finds it gone", async () => {
    api.on("DELETE", `/stories/${storyId(1)}`, json(401, { detail: "Not authenticated." }));
    const { user } = await setup([story(1, viewerAuthor)]);
    await user.click(screen.getByRole("button", { name: "Your story" }));

    await deleteIt(user);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});

describe("StoryViewer: stories that are gone", () => {
  it("skips a story whose picture does not load because the story is gone", async () => {
    api.on("GET", `/stories/${storyId(2)}`, json(404, { detail: "Story not found." }));
    const { user } = await setup([story(1, alice), story(2, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));

    fireEvent.error(picture());

    await waitFor(() => expect(shownStory()).toBe(1));
    expect(within(viewer()).getByText("Story 1 of 1")).toBeInTheDocument();
    expect(screen.queryByText("This picture couldn't be loaded.")).not.toBeInTheDocument();
  });

  it("says when a picture couldn't be loaded of a story that is still there, and Next still works", async () => {
    api.on("GET", `/stories/${storyId(2)}`, json(200, story(2, alice)));
    const { user } = await setup([story(1, alice), story(2, alice)]);
    await user.click(screen.getByRole("button", { name: ALICE }));

    fireEvent.error(picture());

    expect(await within(viewer()).findByText("This picture couldn't be loaded.")).toBeInTheDocument();
    await user.click(button("Next"));
    expect(shownStory()).toBe(1);
  });

  it("skips a story that expires while it is shown", async () => {
    const list = deferred();
    api.on("GET", LIST, list.reply);
    await render();
    stopTime();
    const soon = story(2, alice, { expires_at: new Date(Date.now() + 60_000).toISOString() });
    await act(() => list.respond(json(200, storyPage([story(1, alice), soon]))));
    fireEvent.click(screen.getByRole("button", { name: ALICE }));
    expect(shownStory()).toBe(2);

    await pass(60_000);

    expect(shownStory()).toBe(1);
    expect(within(viewer()).getByText("Story 1 of 1")).toBeInTheDocument();
  });
});

describe("StoryViewer: the authors either side", () => {
  it("shows them beside the story, each at the story it would open on", async () => {
    const { user } = await setup([
      story(1, bob),
      story(2, alice),
      story(3, carol),
      story(4, carol, { viewed_by_me: true }),
    ]);

    await user.click(screen.getByRole("button", { name: ALICE }));

    expect(neighbour("previous")).toHaveTextContent("Bob Example");
    expect(neighbour("next")).toHaveTextContent("Carol Example");
    expect(neighbour("previous").querySelector("img")).toHaveAttribute(
      "src",
      `${API_URL}/stories/${storyId(1)}/media`,
    );
    expect(neighbour("next").querySelector("img")).toHaveAttribute(
      "src",
      `${API_URL}/stories/${storyId(3)}/media`,
    );
    expect(neighbour("next").querySelector("[data-ring]")).toHaveAttribute("data-ring", "unseen");
  });

  it("hides them from screen readers and never gives them focus", async () => {
    const { user } = await setup([story(1, bob), story(2, alice), story(3, carol)]);
    await user.click(screen.getByRole("button", { name: ALICE }));
    const sides = [neighbour("previous"), neighbour("next")];

    for (const side of sides) {
      expect(side).toHaveAttribute("aria-hidden", "true");
      expect(side).not.toHaveAttribute("tabindex");
      expect(side.querySelector("a, button, input, [tabindex]")).toBeNull();
    }
    expect(within(viewer()).queryByRole("img", { name: /Bob|Carol/ })).not.toBeInTheDocument();

    const reached: (string | null)[] = [];
    for (let presses = 0; presses < 6; presses++) {
      await user.tab();
      expect(sides.some((side) => side.contains(document.activeElement))).toBe(false);
      reached.push(document.activeElement!.getAttribute("aria-label") ?? document.activeElement!.getAttribute("href"));
    }
    expect(reached).toEqual(["Previous", "/users/alice_92", "Pause", "Next", "Close", "Previous"]);
  });

  it("records no view when their pictures load", async () => {
    const { user } = await setup([story(1, bob), story(2, alice), story(3, carol)]);
    await user.click(screen.getByRole("button", { name: ALICE }));

    fireEvent.load(neighbour("previous").querySelector("img")!);
    fireEvent.load(neighbour("next").querySelector("img")!);
    await settle();

    expect(api.calls("POST")).toEqual([]);
  });

  it("opens an author on a click, at their first story not viewed yet", async () => {
    const { user } = await setup([
      story(1, bob),
      story(2, alice),
      story(3, alice, { viewed_by_me: true }),
      story(4, carol),
    ]);
    await user.click(screen.getByRole("button", { name: "Stories by Bob Example, new" }));
    expect(screen.queryByTestId("story-previous-author")).not.toBeInTheDocument();

    await user.click(neighbour("next"));
    expect(viewer()).toHaveAccessibleName("Stories by Alice Example");
    expect(shownStory()).toBe(2);

    await user.click(neighbour("previous"));
    expect(viewer()).toHaveAccessibleName("Stories by Bob Example");
    expect(shownStory()).toBe(1);
  });
});
