import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { api, json } from "@/test/api";
import { alice, bob, page, post, postId, viewerAuthor } from "@/test/fixtures";
import { renderSignedIn } from "@/test/render";
import { renderSignedOut } from "@/test/session";
import { PostThread } from "./post-thread";

const main = post(1, alice, { content: "The post itself" });
const reply1 = post(11, bob, { content: "First reply", parent_post_id: postId(1), is_reply: true });
const reply2 = post(12, viewerAuthor, { content: "Second reply", parent_post_id: postId(1), is_reply: true });

function thread(postResponse: object, replies: object = page([reply1, reply2])) {
  api.on("GET", `/posts/${postId(1)}`, json(200, postResponse));
  api.on("GET", `/posts/${postId(1)}/replies`, json(200, replies));
}

describe("PostThread", () => {
  it("shows the post, a place to reply, and its replies", async () => {
    thread(main);
    await renderSignedIn(<PostThread postId={postId(1)} />);

    expect(await screen.findByText("The post itself")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Write a reply" })).toBeInTheDocument();
    const replies = screen.getByRole("region", { name: "Replies" });
    expect(await within(replies).findAllByRole("article")).toHaveLength(2);
    expect(within(replies).getByText("First reply")).toBeInTheDocument();
  });

  it("shows the post a reply answers above it", async () => {
    const parent = post(7, bob, { content: "The parent post" });
    thread({ ...main, parent_post_id: postId(7), is_reply: true }, page([]));
    api.on("GET", `/posts/${postId(7)}`, json(200, parent));
    await renderSignedIn(<PostThread postId={postId(1)} />);

    await screen.findByText("The parent post");
    const [first, second] = screen.getAllByRole("article");
    expect(first).toHaveTextContent("The parent post");
    expect(second).toHaveTextContent("The post itself");
  });

  it("says when the post a reply answers is gone, and still shows the reply", async () => {
    thread({ ...main, parent_post_id: postId(7), is_reply: true }, page([]));
    api.on("GET", `/posts/${postId(7)}`, json(404, { detail: "Post not found." }));
    await renderSignedIn(<PostThread postId={postId(1)} />);

    expect(
      await screen.findByText("This is a reply to a post that was deleted or is no longer available."),
    ).toBeInTheDocument();
    expect(screen.getByText("The post itself")).toBeInTheDocument();
  });

  it("tries the post a reply answers again after it failed to load", async () => {
    thread({ ...main, parent_post_id: postId(7), is_reply: true }, page([]));
    api.on("GET", `/posts/${postId(7)}`, json(503, { detail: "Unavailable." }), json(200, post(7, bob, { content: "The parent post" })));
    await renderSignedIn(<PostThread postId={postId(1)} />);

    expect(await screen.findByText("Couldn't load the post this replies to.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("The parent post")).toBeInTheDocument();
  });

  it("says when the post is unavailable, and asks for no replies", async () => {
    api.on("GET", `/posts/${postId(1)}`, json(404, { detail: "Post not found." }));
    await renderSignedIn(<PostThread postId={postId(1)} />);

    expect(await screen.findByText("This post is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/");
    expect(api.calls("GET", `/posts/${postId(1)}/replies`)).toEqual([]);
  });

  it("asks the backend nothing for an address that is not a post id", async () => {
    await renderSignedIn(<PostThread postId="not-a-post" />);

    expect(await screen.findByText("This post is unavailable")).toBeInTheDocument();
    expect(api.calls().filter((call) => call.path.startsWith("/posts"))).toEqual([]);
  });

  it("explains a failure to load the post, and loads it again on request", async () => {
    api.on("GET", `/posts/${postId(1)}`, json(503, { detail: "Unavailable." }), json(200, main));
    api.on("GET", `/posts/${postId(1)}/replies`, json(200, page([])));
    await renderSignedIn(<PostThread postId={postId(1)} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this post");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("The post itself")).toBeInTheDocument();
    expect(await screen.findByText("No replies yet")).toBeInTheDocument();
  });

  it("explains a failure to load the replies, and keeps the post", async () => {
    api.on("GET", `/posts/${postId(1)}`, json(200, main));
    api.on("GET", `/posts/${postId(1)}/replies`, json(503, { detail: "Unavailable." }));
    await renderSignedIn(<PostThread postId={postId(1)} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load replies");
    expect(screen.getByText("The post itself")).toBeInTheDocument();
  });

  it("publishes a reply to the post and shows it first among the replies", async () => {
    thread(main);
    api.on(
      "POST",
      "/posts",
      json(201, post(13, viewerAuthor, { content: "My reply", parent_post_id: postId(1), is_reply: true })),
    );
    await renderSignedIn(<PostThread postId={postId(1)} />);
    const user = userEvent.setup();
    const replies = screen.getByRole("region", { name: "Replies" });
    await within(replies).findAllByRole("article");

    await user.type(screen.getByRole("textbox", { name: "Write a reply" }), "My reply");
    await user.click(screen.getByRole("button", { name: "Reply" }));

    await waitFor(() => expect(within(replies).getAllByRole("article")).toHaveLength(3));
    expect(within(replies).getAllByRole("article")[0]).toHaveTextContent("My reply");
    expect(api.calls("POST", "/posts")[0].body).toEqual({ content: "My reply", parent_post_id: postId(1) });
  });

  it("asks a visitor without a session to log in to reply, like or repost", async () => {
    thread(main, page([]));
    await renderSignedOut(<PostThread postId={postId(1)} />);

    expect(await screen.findByRole("link", { name: "Log in to reply" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("textbox", { name: "Write a reply" })).not.toBeInTheDocument();
    const article = screen.getByRole("article");
    for (const button of within(article).getAllByRole("button", { name: /^(Like|Repost)/ })) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Log in to like or repost");
    }
  });

  it("offers a visitor without a session the login page for an unavailable post", async () => {
    api.on("GET", `/posts/${postId(1)}`, json(404, { detail: "Post not found." }));
    await renderSignedOut(<PostThread postId={postId(1)} />);

    expect(await screen.findByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });
});
