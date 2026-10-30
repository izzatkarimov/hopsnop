import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/auth/require-auth";
import { api, deferred, json, noContent } from "@/test/api";
import { alice, bob, page, post, postId, storyPage, viewerAuthor } from "@/test/fixtures";
import { authState, renderSignedIn } from "@/test/render";
import { HomeFeed } from "./home-feed";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const byAlice = post(1, alice, { content: "Alice's post", like_count: 2, repost_count: 1 });
const mine = post(2, viewerAuthor, { content: "My own post" });
const byBob = post(3, bob, { content: "Bob's post" });

async function setup(...feed: Parameters<typeof api.on>[2][]) {
  api.on("GET", "/stories?limit=50", json(200, storyPage([])));
  api.on("GET", "/feed", ...feed);
  await renderSignedIn(
    <RequireAuth>
      <HomeFeed />
    </RequireAuth>,
  );
  return { user: userEvent.setup() };
}

function postBy(name: string) {
  return screen.getByRole("article", { name: `Post by ${name}` });
}

async function postsShown() {
  const articles = await screen.findAllByRole("article");
  return articles.map((article) => article.getAttribute("aria-label"));
}

/** Browsers keep the space after sr-only "Like, "; dom-accessibility-api drops it. */
function counted(label: string, count: number) {
  return new RegExp(`^${label}, ?${count}$`);
}

function likeButton(name: string) {
  return within(postBy(name)).getByRole("button", { name: /^Like/ });
}

function repostButton(name: string) {
  return within(postBy(name)).getByRole("button", { name: /^Repost/ });
}

describe("HomeFeed: loading the feed", () => {
  it("shows a placeholder, then the posts in the backend's order", async () => {
    const feed = deferred();
    await setup(feed.reply);

    expect(screen.getByText("Loading posts…")).toBeInTheDocument();

    await act(() => feed.respond(json(200, page([byAlice, mine, byBob]))));

    expect(await postsShown()).toEqual(["Post by Alice Example", "Post by Test Viewer", "Post by Bob Example"]);
    expect(within(postBy("Alice Example")).getByText("Alice's post")).toBeInTheDocument();
  });

  it("says when there are no posts yet", async () => {
    await setup(json(200, page([])));

    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("explains a failure to load, and loads again on request", async () => {
    const { user } = await setup(json(503, { detail: "Unavailable." }), json(200, page([byAlice])));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load posts");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await postsShown()).toEqual(["Post by Alice Example"]);
  });

  it("loads the next page on request, without showing a post twice", async () => {
    api.on("GET", "/feed?cursor=page-2", json(200, page([mine, byBob])));
    const { user } = await setup(json(200, page([byAlice, mine], "page-2")));
    await postsShown();

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(3));
    expect(await postsShown()).toEqual(["Post by Alice Example", "Post by Test Viewer", "Post by Bob Example"]);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("keeps the posts when the next page fails, and tries that page again", async () => {
    api.on("GET", "/feed?cursor=page-2", json(503, { detail: "Unavailable." }), json(200, page([byBob])));
    const { user } = await setup(json(200, page([byAlice], "page-2")));
    await postsShown();

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(await postsShown()).toEqual(["Post by Alice Example"]);

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(api.calls("GET", "/feed?cursor=page-2")).toHaveLength(2);
  });

  it("asks for the next page once, however often it is asked for at the same moment", async () => {
    const next = deferred();
    api.on("GET", "/feed?cursor=page-2", next.reply);
    await setup(json(200, page([byAlice], "page-2")));
    await postsShown();
    const button = screen.getByRole("button", { name: "Load more" });

    act(() => {
      button.click();
      button.click();
    });

    expect(api.calls("GET", "/feed?cursor=page-2")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    await act(() => next.respond(json(200, page([byBob]))));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  });

  it("puts a new post at the top of For you", async () => {
    api.on("POST", "/posts", json(201, post(9, viewerAuthor, { content: "Just written" })));
    const { user } = await setup(json(200, page([byAlice])));
    await postsShown();

    await user.type(screen.getByRole("textbox", { name: "Write a post" }), "Just written");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(within(screen.getAllByRole("article")[0]).getByText("Just written")).toBeInTheDocument();
  });

  it("loads Following only when its tab is opened", async () => {
    api.on("GET", "/feed/following", json(200, page([])));
    const { user } = await setup(json(200, page([byAlice])));
    await postsShown();
    expect(api.calls("GET", "/feed/following")).toEqual([]);

    await user.click(screen.getByRole("tab", { name: "Following" }));

    expect(await screen.findByText("Your Following feed is empty")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Following" })).toHaveAttribute("aria-selected", "true");
    expect(api.calls("GET", "/feed/following")).toHaveLength(1);
  });

  it("keeps the feed working when the stories cannot be loaded", async () => {
    api.on("GET", "/stories?limit=50", json(503, { detail: "Unavailable." }));
    api.on("GET", "/feed", json(200, page([byAlice])));
    await renderSignedIn(
      <RequireAuth>
        <HomeFeed />
      </RequireAuth>,
    );
    const user = userEvent.setup();

    expect(await postsShown()).toEqual(["Post by Alice Example"]);
    const stories = screen.getByRole("region", { name: "Stories" });
    expect(await within(stories).findByRole("alert")).toHaveTextContent("Couldn't load stories.");
    expect(within(stories).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    api.on("POST", `/posts/${postId(1)}/like`, json(200, { liked: true, like_count: 3 }));
    await user.click(likeButton("Alice Example"));
    await waitFor(() => expect(likeButton("Alice Example")).toHaveAccessibleName(counted("Like", 3)));
    expect(likeButton("Alice Example")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("HomeFeed: likes and reposts", () => {
  it("likes at once, then shows the backend's count; and takes the like back", async () => {
    const like = deferred();
    api.on("POST", `/posts/${postId(1)}/like`, like.reply);
    api.on("DELETE", `/posts/${postId(1)}/like`, json(200, { liked: false, like_count: 6 }));
    const { user } = await setup(json(200, page([byAlice])));
    await postsShown();
    expect(likeButton("Alice Example")).toHaveAttribute("aria-pressed", "false");

    await user.click(likeButton("Alice Example"));
    expect(likeButton("Alice Example")).toHaveAttribute("aria-pressed", "true");
    expect(likeButton("Alice Example")).toHaveAccessibleName(counted("Like", 3));

    await act(() => like.respond(json(200, { liked: true, like_count: 7 })));
    await waitFor(() => expect(likeButton("Alice Example")).toHaveAccessibleName(counted("Like", 7)));

    await user.click(likeButton("Alice Example"));
    await waitFor(() => expect(likeButton("Alice Example")).toHaveAccessibleName(counted("Like", 6)));
    expect(likeButton("Alice Example")).toHaveAttribute("aria-pressed", "false");
  });

  it("reposts and undoes the repost, showing the backend's count", async () => {
    api.on("POST", `/posts/${postId(1)}/repost`, json(200, { reposted: true, repost_count: 4 }));
    api.on("DELETE", `/posts/${postId(1)}/repost`, json(200, { reposted: false, repost_count: 3 }));
    const { user } = await setup(json(200, page([byAlice])));
    await postsShown();

    await user.click(repostButton("Alice Example"));
    await waitFor(() => expect(repostButton("Alice Example")).toHaveAccessibleName(counted("Repost", 4)));
    expect(repostButton("Alice Example")).toHaveAttribute("aria-pressed", "true");

    await user.click(repostButton("Alice Example"));
    await waitFor(() => expect(repostButton("Alice Example")).toHaveAccessibleName(counted("Repost", 3)));
    expect(repostButton("Alice Example")).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    ["a server error", json(500, { detail: "Internal server error." }), "Something went wrong. Please try again."],
    ["a refusal", json(403, { detail: "Forbidden." }), "You're not allowed to like this post."],
  ])("puts the like back and explains %s", async (_, reply, message) => {
    api.on("POST", `/posts/${postId(1)}/like`, reply);
    const { user } = await setup(json(200, page([byAlice])));
    await postsShown();

    await user.click(likeButton("Alice Example"));

    expect(await within(postBy("Alice Example")).findByRole("alert")).toHaveTextContent(message);
    expect(likeButton("Alice Example")).toHaveAttribute("aria-pressed", "false");
    expect(likeButton("Alice Example")).toHaveAccessibleName(counted("Like", 2));
  });

  it("sends one request per post until it is answered, however often it is clicked", async () => {
    const like = deferred();
    api.on("POST", `/posts/${postId(1)}/like`, like.reply);
    const { user } = await setup(json(200, page([byAlice])));
    await postsShown();

    await user.click(likeButton("Alice Example"));
    await user.click(likeButton("Alice Example"));
    await user.click(likeButton("Alice Example"));

    expect(api.calls("POST", `/posts/${postId(1)}/like`)).toHaveLength(1);
    expect(api.calls("DELETE")).toEqual([]);
    await act(() => like.respond(json(200, { liked: true, like_count: 3 })));
    await waitFor(() => expect(likeButton("Alice Example")).toHaveAccessibleName(counted("Like", 3)));
  });

  it("takes out a post that turns out to be gone", async () => {
    api.on("POST", `/posts/${postId(1)}/like`, json(404, { detail: "Post not found." }));
    const { user } = await setup(json(200, page([byAlice, byBob])));
    await postsShown();

    await user.click(likeButton("Alice Example"));

    expect(await screen.findByText("A post was removed because it is no longer available.")).toBeInTheDocument();
    expect(await postsShown()).toEqual(["Post by Bob Example"]);
  });

  it("lets go of the user when a like finds the session ended", async () => {
    api.on("POST", `/posts/${postId(1)}/like`, json(401, { detail: "Not authenticated." }));
    const { user } = await setup(json(200, page([byAlice])));
    await postsShown();

    await user.click(likeButton("Alice Example"));

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(router.replace).toHaveBeenCalledWith("/login");
  });
});

describe("HomeFeed: one's own posts", () => {
  async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(within(postBy(name)).getByRole("button", { name: "More options" }));
    return screen.getByRole("menu", { name: "Post options" });
  }

  it("offers to delete only the viewer's own posts", async () => {
    const { user } = await setup(json(200, page([byAlice, mine])));
    await postsShown();

    const othersMenu = await openMenu(user, "Alice Example");
    expect(within(othersMenu).queryByRole("menuitem", { name: "Delete post" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    const ownMenu = await openMenu(user, "Test Viewer");
    expect(within(ownMenu).getByRole("menuitem", { name: "Delete post" })).toBeInTheDocument();
  });

  it("asks before deleting, and Cancel sends nothing", async () => {
    const { user } = await setup(json(200, page([mine])));
    await postsShown();

    await user.click(within(await openMenu(user, "Test Viewer")).getByRole("menuitem", { name: "Delete post" }));
    const confirm = within(postBy("Test Viewer")).getByRole("group", { name: "Delete post" });
    expect(confirm).toHaveTextContent("Delete this post? This can't be undone.");

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(within(postBy("Test Viewer")).queryByRole("group")).not.toBeInTheDocument();
    expect(api.calls("DELETE")).toEqual([]);
  });

  it("deletes the post once confirmed, and says so", async () => {
    api.on("DELETE", `/posts/${postId(2)}`, noContent());
    const { user } = await setup(json(200, page([byAlice, mine])));
    await postsShown();

    await user.click(within(await openMenu(user, "Test Viewer")).getByRole("menuitem", { name: "Delete post" }));
    await user.click(within(postBy("Test Viewer")).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Your post was deleted.")).toBeInTheDocument();
    expect(await postsShown()).toEqual(["Post by Alice Example"]);
    expect(api.calls("DELETE", `/posts/${postId(2)}`)).toHaveLength(1);
  });

  it("keeps the post and explains a failed delete", async () => {
    api.on("DELETE", `/posts/${postId(2)}`, json(500, { detail: "Internal server error." }));
    const { user } = await setup(json(200, page([mine])));
    await postsShown();

    await user.click(within(await openMenu(user, "Test Viewer")).getByRole("menuitem", { name: "Delete post" }));
    await user.click(within(postBy("Test Viewer")).getByRole("button", { name: "Delete" }));

    expect(await within(postBy("Test Viewer")).findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );
    expect(screen.getByText("My own post")).toBeInTheDocument();
  });

  it("edits a recent post and shows that it was edited", async () => {
    const createdAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const recent = post(4, viewerAuthor, { content: "Frist try", created_at: createdAt, updated_at: createdAt });
    api.on(
      "PATCH",
      `/posts/${postId(4)}`,
      json(200, { ...recent, content: "First try", updated_at: new Date().toISOString() }),
    );
    const { user } = await setup(json(200, page([recent])));
    await postsShown();

    await user.click(within(await openMenu(user, "Test Viewer")).getByRole("menuitem", { name: "Edit post" }));
    const text = within(postBy("Test Viewer")).getByRole("textbox", { name: "Post text" });
    await user.clear(text);
    await user.type(text, "First try");
    await user.click(within(postBy("Test Viewer")).getByRole("button", { name: "Save" }));

    expect(await within(postBy("Test Viewer")).findByText("First try")).toBeInTheDocument();
    expect(within(postBy("Test Viewer")).getByText("Edited")).toBeInTheDocument();
    expect(api.calls("PATCH")[0].body).toEqual({ content: "First try" });
  });

  it("does not offer to edit a post older than the backend's 60 minutes", async () => {
    const old = new Date(Date.now() - 61 * 60_000).toISOString();
    const { user } = await setup(json(200, page([post(5, viewerAuthor, { created_at: old, updated_at: old })])));
    await postsShown();

    const menu = await openMenu(user, "Test Viewer");

    expect(within(menu).queryByRole("menuitem", { name: "Edit post" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete post" })).toBeInTheDocument();
  });
});
