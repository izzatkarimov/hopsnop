import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createPost } from "@/lib/posts";
import type { User } from "@/lib/types";
import { api, deferred, json } from "@/test/api";
import { post, viewerAuthor } from "@/test/fixtures";
import { account, authState, renderSignedIn } from "@/test/render";
import { PostComposer } from "./post-composer";

const viewer: User = {
  id: account.id,
  username: account.username,
  displayName: account.display_name,
  avatarUrl: null,
};

/** Publishes through the API, as the pages do. */
async function publish(content: string) {
  await createPost(content);
}

async function setup(kind?: "post" | "reply") {
  await renderSignedIn(<PostComposer viewer={viewer} kind={kind} onSubmit={publish} />);
  const user = userEvent.setup();
  const text = screen.getByRole("textbox", { name: kind === "reply" ? "Write a reply" : "Write a post" });
  return { user, text, submit: screen.getByRole("button", { name: kind === "reply" ? "Reply" : "Post" }) };
}

const postRequests = () => api.calls("POST", "/posts");

/**
 * The counter as the field's description. Browsers read it as "20
 * characters remaining"; dom-accessibility-api, which jest-dom uses, drops
 * the space that starts the screen-reader-only part. Number and words are
 * still matched exactly.
 */
function remaining(count: number) {
  return new RegExp(`^${count} ?characters remaining$`);
}

/** Two submissions in the same moment, before React can render in between. */
function submitTwiceAtOnce(form: HTMLFormElement) {
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("PostComposer", () => {
  it("cannot publish an empty or blank text", async () => {
    const { user, text, submit } = await setup();
    expect(submit).toBeDisabled();

    await user.type(text, "   ");
    expect(submit).toBeDisabled();
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(postRequests()).toEqual([]);
  });

  it("counts down the last 20 characters", async () => {
    const { user, text } = await setup();

    await user.click(text);
    await user.paste("a".repeat(279));
    expect(text).not.toHaveAccessibleDescription();

    await user.type(text, "a");
    expect(text).toHaveAccessibleDescription(remaining(20));
  });

  it("refuses more than 300 characters, counted as the backend counts them", async () => {
    const { user, text, submit } = await setup();

    await user.click(text);
    // An emoji is one character, though two UTF-16 code units.
    await user.paste("😀".repeat(300));
    expect(text).toHaveAccessibleDescription(remaining(0));
    expect(submit).toBeEnabled();

    await user.type(text, "!");
    expect(text).toHaveAccessibleDescription(remaining(-1));
    expect(text).toBeInvalid();
    expect(submit).toBeDisabled();
  });

  it("refuses a character the backend cannot store", async () => {
    const { user, text, submit } = await setup();

    await user.click(text);
    await user.paste("Hello\u0000there");

    expect(screen.getByRole("alert")).toHaveTextContent("This text contains a character that can't be posted.");
    expect(submit).toBeDisabled();
  });

  it("publishes the text without surrounding spaces, then clears it and says so", async () => {
    api.on("POST", "/posts", json(201, post(1, viewerAuthor, { content: "Hello, Hopsnop" })));
    const { user, text, submit } = await setup();

    await user.type(text, "  Hello, Hopsnop  ");
    await user.click(submit);

    await waitFor(() => expect(text).toHaveValue(""));
    expect(postRequests().map((call) => call.body)).toEqual([{ content: "Hello, Hopsnop" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Your post was published.");
  });

  it("publishes with Ctrl+Enter", async () => {
    api.on("POST", "/posts", json(201, post(1, viewerAuthor)));
    const { user, text } = await setup();

    await user.type(text, "Hello");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(postRequests()).toHaveLength(1));
  });

  it.each([
    [
      "the backend's own rejection",
      json(422, { detail: [{ loc: ["body", "content"], msg: "Value error, Post content must not be blank.", type: "value_error" }] }),
      "Post content must not be blank.",
    ],
    ["a refusal", json(403, { detail: "Email address is not verified." }), "You're not allowed to post right now."],
    ["a server error", json(500, { detail: "Internal server error." }), "Something went wrong. Please try again."],
  ])("keeps the text and explains %s", async (_, reply, message) => {
    api.on("POST", "/posts", reply);
    const { user, text, submit } = await setup();
    await user.type(text, "Hello");

    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(text).toHaveValue("Hello");
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(submit).toBeEnabled();
  });

  it("explains that a reply's post is gone", async () => {
    api.on("POST", "/posts", json(404, { detail: "Post not found." }));
    const { user, text, submit } = await setup("reply");
    await user.type(text, "A reply");

    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This post is no longer available, so it can't be replied to.",
    );
  });

  it("publishes once, however often it is sent at the same moment", async () => {
    const answer = deferred();
    api.on("POST", "/posts", answer.reply);
    const { user, text, submit } = await setup();
    await user.type(text, "Hello");

    submitTwiceAtOnce(submit.closest("form")!);

    expect(postRequests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Posting…" })).toBeDisabled();
    // Not editable while it is being published, but it keeps the focus.
    expect(text).toHaveAttribute("readonly");

    await act(() => answer.respond(json(201, post(1, viewerAuthor))));
    await waitFor(() => expect(text).toHaveValue(""));
    expect(postRequests()).toHaveLength(1);
  });

  it("lets go of the user when the session has ended", async () => {
    api.on("POST", "/posts", json(401, { detail: "Not authenticated." }));
    const { user, text, submit } = await setup();
    await user.type(text, "Hello");

    await user.click(submit);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});
