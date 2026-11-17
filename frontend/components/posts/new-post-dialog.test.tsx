import { useEffect, useState } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/auth/require-auth";
import { api, deferred, json, networkError } from "@/test/api";
import { alice, page, post, storyPage, viewerAuthor } from "@/test/fixtures";
import { authState, renderSignedIn } from "@/test/render";
import { HomeFeed } from "./home-feed";
import { NewPostProvider, useNewPost } from "./new-post";

const nav = vi.hoisted(() => ({
  pathname: "/",
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav.router,
}));

beforeEach(() => {
  nav.pathname = "/";
});

function Opener() {
  const { open } = useNewPost();
  return (
    <button type="button" onClick={open}>
      New post
    </button>
  );
}

async function openDialog() {
  await renderSignedIn(
    <RequireAuth>
      <NewPostProvider>
        <Opener />
      </NewPostProvider>
    </RequireAuth>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New post" }));
  const dialog = screen.getByRole("dialog", { name: "New post" });
  return {
    user,
    dialog,
    text: within(dialog).getByRole("textbox", { name: "Write a post" }),
    submit: within(dialog).getByRole("button", { name: "Post" }),
  };
}

const postRequests = () => api.calls("POST", "/posts");

/** Browsers keep this space; dom-accessibility-api, which jest-dom uses, drops it. */
function remaining(count: number) {
  return new RegExp(`^${count} ?characters remaining$`);
}

function ringTone(dialog: HTMLElement) {
  return dialog.querySelector("svg[data-tone]")!.getAttribute("data-tone");
}

describe("New post dialog: opening and closing", () => {
  it("opens with the text field ready, next to the user's name", async () => {
    const { dialog, text, submit } = await openDialog();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(text).toHaveFocus();
    expect(dialog).toHaveTextContent("Test Viewer");
    expect(submit).toBeDisabled();
  });

  it("closes at once when nothing was written", async () => {
    const { user } = await openDialog();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New post" })).toHaveFocus();
  });

  it("asks before throwing away what was written, and keeps it on request", async () => {
    const { user, dialog, text } = await openDialog();
    await user.type(text, "Half a thought");

    await user.keyboard("{Escape}");

    const confirm = within(dialog).getByRole("group", { name: "Discard this post?" });
    expect(within(confirm).getByRole("button", { name: "Keep editing" })).toHaveFocus();

    await user.click(within(confirm).getByRole("button", { name: "Keep editing" }));

    expect(text).toHaveValue("Half a thought");
    expect(text).toHaveFocus();
    expect(postRequests()).toEqual([]);
  });

  it("throws the text away when asked to, from Cancel too", async () => {
    const { user, dialog, text } = await openDialog();
    await user.type(text, "Never mind");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postRequests()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "New post" }));
    expect(screen.getByRole("textbox", { name: "Write a post" })).toHaveValue("");
  });

  it("goes back to the text when Escape is pressed while asking", async () => {
    const { user, dialog, text } = await openDialog();
    await user.type(text, "Still here");

    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");

    expect(within(dialog).queryByRole("group", { name: "Discard this post?" })).not.toBeInTheDocument();
    expect(text).toHaveValue("Still here");
  });
});

describe("New post dialog: the character limit", () => {
  it("counts down the last 20 characters, and warns", async () => {
    const { user, dialog, text } = await openDialog();

    await user.click(text);
    await user.paste("a".repeat(279));
    expect(text).not.toHaveAccessibleDescription();
    expect(ringTone(dialog)).toBe("ok");

    await user.type(text, "a");
    expect(text).toHaveAccessibleDescription(remaining(20));
    expect(ringTone(dialog)).toBe("near");
  });

  it("allows 300 characters as the backend counts them, and refuses 301", async () => {
    const { user, dialog, text, submit } = await openDialog();

    await user.click(text);
    // An emoji is one character, though two UTF-16 code units.
    await user.paste("😀".repeat(300));
    expect(text).toHaveAccessibleDescription(remaining(0));
    expect(submit).toBeEnabled();

    await user.type(text, "!");
    expect(text).toHaveAccessibleDescription(remaining(-1));
    expect(text).toBeInvalid();
    expect(ringTone(dialog)).toBe("over");
    expect(submit).toBeDisabled();
  });

  it("refuses blank text and a character the backend cannot store", async () => {
    const { user, dialog, text, submit } = await openDialog();

    await user.type(text, "   ");
    expect(submit).toBeDisabled();

    await user.clear(text);
    await user.click(text);
    await user.paste("Hello\u0000there");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "This text contains a character that can't be posted.",
    );
    expect(submit).toBeDisabled();
  });
});

describe("New post dialog: posting", () => {
  it("sends the trimmed text once, closes, says so and gives focus back", async () => {
    api.on("POST", "/posts", json(201, post(9, viewerAuthor, { content: "Hello, Hopsnop" })));
    const { user, text, submit } = await openDialog();

    await user.type(text, "  Hello, Hopsnop  ");
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(postRequests().map((call) => call.body)).toEqual([{ content: "Hello, Hopsnop" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Your post was published.");
    expect(screen.getByRole("button", { name: "New post" })).toHaveFocus();
    expect(nav.router.push).not.toHaveBeenCalled();
  });

  it("goes to Home after posting from another page", async () => {
    nav.pathname = "/settings";
    api.on("POST", "/posts", json(201, post(9, viewerAuthor)));
    const { user, text } = await openDialog();

    await user.type(text, "From settings");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith("/"));
  });

  it("sends once, however often it is sent at the same moment, and can't be closed meanwhile", async () => {
    const answer = deferred();
    api.on("POST", "/posts", answer.reply);
    const { user, dialog, text, submit } = await openDialog();
    await user.type(text, "Hello");

    await user.click(submit);
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(postRequests()).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "Posting…" })).toBeDisabled();
    expect(text).toHaveAttribute("readonly");
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(() => answer.respond(json(201, post(1, viewerAuthor))));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(postRequests()).toHaveLength(1);
  });

  it.each([
    [
      "the backend's own rejection",
      json(422, { detail: [{ loc: ["body", "content"], msg: "Value error, Post content must not be blank.", type: "value_error" }] }),
      "Post content must not be blank.",
    ],
    ["a refusal", json(403, { detail: "Email address is not verified." }), "You're not allowed to post right now."],
    [
      "too many posts",
      json(429, { detail: "Too many requests." }, { "Retry-After": "30" }),
      "Too many attempts. Please wait 30 seconds before trying again.",
    ],
    ["no connection", networkError(), "Couldn't reach Hopsnop. Check your connection and try again."],
  ])("keeps the text and explains %s", async (_, reply, message) => {
    api.on("POST", "/posts", reply);
    const { user, dialog, text, submit } = await openDialog();
    await user.type(text, "Hello");

    await user.click(submit);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    expect(text).toHaveValue("Hello");
    expect(submit).toBeEnabled();
  });

  it("lets go of the user when the session has ended", async () => {
    api.on("POST", "/posts", json(401, { detail: "Not authenticated." }));
    const { user, text, submit } = await openDialog();
    await user.type(text, "Hello");

    await user.click(submit);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});

describe("New post dialog: after posting elsewhere", () => {
  /** Another page with the New post button, until the router goes Home. */
  function Pages() {
    const [home, setHome] = useState(false);
    useEffect(() => {
      nav.router.push.mockImplementation(() => setHome(true));
    }, []);
    return home ? <HomeFeed /> : <Opener />;
  }

  it("shows the post at the top of Home, even before Home's feed has loaded", async () => {
    nav.pathname = "/settings";
    api.on("POST", "/posts", json(201, post(9, viewerAuthor, { content: "Fresh from settings" })));
    api.on("GET", "/stories?limit=50", json(200, storyPage([])));
    const feed = deferred();
    api.on("GET", "/feed", feed.reply);
    await renderSignedIn(
      <RequireAuth>
        <NewPostProvider>
          <Pages />
        </NewPostProvider>
      </RequireAuth>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New post" }));
    await user.type(screen.getByRole("textbox", { name: "Write a post" }), "Fresh from settings");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Post" }));

    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith("/"));
    await act(() => feed.respond(json(200, page([post(1, alice, { content: "Older post" })]))));

    const articles = await screen.findAllByRole("article");
    expect(articles.map((article) => article.textContent)).toEqual([
      expect.stringContaining("Fresh from settings"),
      expect.stringContaining("Older post"),
    ]);
  });
});
