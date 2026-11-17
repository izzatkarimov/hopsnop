import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toPost } from "@/lib/posts";
import { api, json } from "@/test/api";
import { alice, post, postId, viewerAuthor } from "@/test/fixtures";
import { account, renderSignedIn } from "@/test/render";
import { renderSignedOut } from "@/test/session";
import { PostItem } from "./post-item";
import type { PostHandlers } from "./use-post-actions";

const byAlice = toPost(post(1, alice, { content: "Alice's words", like_count: 3, liked_by_me: true, repost_count: 2, reposted_by_me: true }));
const mine = toPost(post(2, viewerAuthor, { content: "My words" }));
const FOLLOW_STATUS = `/users/${alice.username}/follow-status`;

function handlers(viewerId: string | null = account.id): PostHandlers {
  return {
    viewerId,
    actionErrors: {},
    canEdit: () => true,
    onToggleLike: vi.fn(),
    onToggleRepost: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };
}

const urlOf = (id: string) => `${window.location.origin}/posts/${id}`;

afterEach(() => {
  // jsdom has no share sheet; a test may have added one.
  Reflect.deleteProperty(navigator, "share");
});

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "More options" }));
  return screen.getByRole("menu", { name: "Post options" });
}

describe("PostItem: actions", () => {
  it("shows a like and a repost as pressed, with their counts", async () => {
    await renderSignedIn(<PostItem post={byAlice} handlers={handlers()} />);

    expect(screen.getByRole("button", { name: /^Like/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Like/ })).toHaveAccessibleName(/^Like, ?3$/);
    expect(screen.getByRole("button", { name: /^Repost/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Reply" })).toHaveAttribute("href", `/posts/${postId(1)}`);
  });

  it("shares the post's plain address through the system share sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    await renderSignedIn(<PostItem post={byAlice} handlers={handlers()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Share" }));

    expect(share).toHaveBeenCalledWith({ title: "Post by Alice Example on Hopsnop", url: urlOf(postId(1)) });
  });

  it("copies the link where there is no share sheet, and says so", async () => {
    await renderSignedIn(<PostItem post={byAlice} handlers={handlers()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(urlOf(postId(1)));
  });

  it("says when the link can be neither shared nor copied", async () => {
    await renderSignedIn(<PostItem post={byAlice} handlers={handlers()} />);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied"));

    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(
      await screen.findByText("Couldn't share or copy the link: this browser didn't allow it."),
    ).toBeInTheDocument();
  });

  it("says nothing when sharing is cancelled", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    await renderSignedIn(<PostItem post={byAlice} handlers={handlers()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByText(/copied|couldn't/i)).not.toBeInTheDocument();
  });

  it("can share, but not like or repost, without a session", async () => {
    await renderSignedOut(<PostItem post={byAlice} handlers={handlers(null)} />);

    expect(screen.getByRole("button", { name: /^Like/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Repost/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
  });
});

describe("PostItem: the menu", () => {
  it("copies the post's link and its text, says so, and gives focus back", async () => {
    api.on("GET", FOLLOW_STATUS, json(200, { following: false }));
    await renderSignedIn(<PostItem post={byAlice} handlers={handlers()} />);
    const user = userEvent.setup();

    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Copy link" }));
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(urlOf(postId(1)));
    expect(screen.getByRole("button", { name: "More options" })).toHaveFocus();

    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Copy text" }));
    expect(await screen.findByText("Text copied.")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("Alice's words");
  });

  it("says when the clipboard refuses", async () => {
    api.on("GET", FOLLOW_STATUS, json(200, { following: false }));
    await renderSignedIn(<PostItem post={byAlice} handlers={handlers()} />);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied"));

    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Copy text" }));

    expect(
      await screen.findByText("Couldn't copy the text: this browser didn't allow it."),
    ).toBeInTheDocument();
  });

  it("offers Unfollow only for someone followed, and unfollows", async () => {
    api.on("GET", FOLLOW_STATUS, json(200, { following: true }));
    api.on("DELETE", `/users/${alice.username}/follow`, json(200, { following: false }));
    await renderSignedIn(<PostItem post={byAlice} handlers={handlers()} />);
    const user = userEvent.setup();

    const menu = await openMenu(user);
    await user.click(await within(menu).findByRole("menuitem", { name: "Unfollow @alice_92" }));

    expect(await screen.findByText("You unfollowed @alice_92.")).toBeInTheDocument();
    expect(api.calls("DELETE", `/users/${alice.username}/follow`)).toHaveLength(1);
  });

  it.each([
    ["isn't followed", json(200, { following: false })],
    ["can't be asked about", json(500, { detail: "Internal server error." })],
  ])("leaves Unfollow out, quietly, for someone who %s", async (_, reply) => {
    api.on("GET", FOLLOW_STATUS, reply);
    await renderSignedIn(<PostItem post={byAlice} handlers={handlers()} />);
    const user = userEvent.setup();

    const menu = await openMenu(user);
    await waitFor(() => expect(api.calls("GET", FOLLOW_STATUS)).toHaveLength(1));

    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Copy link",
      "Copy text",
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks nothing about following for one's own post, and offers to edit and delete it", async () => {
    await renderSignedIn(<PostItem post={mine} handlers={handlers()} />);
    const user = userEvent.setup();

    const menu = await openMenu(user);

    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Copy link",
      "Copy text",
      "Edit post",
      "Delete post",
    ]);
  });

  it("asks nothing about following without a session", async () => {
    await renderSignedOut(<PostItem post={byAlice} handlers={handlers(null)} />);
    const user = userEvent.setup();

    const menu = await openMenu(user);

    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
    expect(api.calls("GET", FOLLOW_STATUS)).toEqual([]);
  });

  it("keeps the menu's keyboard pattern", async () => {
    await renderSignedIn(<PostItem post={mine} handlers={handlers()} />);
    const user = userEvent.setup();

    const menu = await openMenu(user);
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{End}");
    expect(items[3]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More options" })).toHaveFocus();
  });
});
