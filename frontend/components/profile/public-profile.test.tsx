import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { api, deferred, json } from "@/test/api";
import { alice, page, post, profile, viewerAuthor } from "@/test/fixtures";
import { authState, renderSignedIn } from "@/test/render";
import { renderSignedOut } from "@/test/session";
import { PublicProfile } from "./public-profile";

const PROFILE = "/users/alice_92";
const POSTS = "/users/alice_92/posts";
const FOLLOW = "/users/alice_92/follow";

function details() {
  return screen.getByRole("region", { name: "Profile details" });
}

async function setupFollowing(following: boolean, ...afterChange: Parameters<typeof api.on>[2][]) {
  api.on("GET", PROFILE, json(200, profile(alice, { following })), ...afterChange);
  api.on("GET", POSTS, json(200, page([])));
  await renderSignedIn(<PublicProfile username="alice_92" />);
  const user = userEvent.setup();
  const button = await screen.findByRole("button", { name: following ? "Following" : "Follow" });
  return { user, button };
}

describe("PublicProfile", () => {
  it("shows a placeholder, then who the account is and its posts", async () => {
    const answer = deferred();
    api.on("GET", PROFILE, answer.reply);
    api.on("GET", POSTS, json(200, page([post(1, alice, { content: "Alice's post" })])));
    await renderSignedIn(<PublicProfile username="alice_92" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading profile…");

    await act(() => answer.respond(json(200, profile(alice, { bio: "Writes about trains." }))));

    expect(await screen.findByRole("heading", { name: "Alice Example" })).toBeInTheDocument();
    expect(details()).toHaveTextContent("@alice_92");
    expect(details()).toHaveTextContent("Writes about trains.");
    expect(details()).toHaveTextContent("1 Following");
    expect(details()).toHaveTextContent("3 Followers");
    expect(await screen.findByText("Alice's post")).toBeInTheDocument();
  });

  it("says when there is no such profile, and asks for no posts", async () => {
    api.on("GET", PROFILE, json(404, { detail: "User not found." }));
    await renderSignedIn(<PublicProfile username="alice_92" />);

    expect(await screen.findByText("Profile not found")).toBeInTheDocument();
    expect(screen.getByText("This account doesn't exist or isn't available.")).toBeInTheDocument();
    expect(api.calls("GET", POSTS)).toEqual([]);
  });

  it("explains a failure to load, and loads again on request", async () => {
    api.on("GET", PROFILE, json(503, { detail: "Unavailable." }), json(200, profile(alice)));
    api.on("GET", POSTS, json(200, page([])));
    await renderSignedIn(<PublicProfile username="alice_92" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this profile");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Alice Example" })).toBeInTheDocument();
  });

  it("says when the account has not posted, using its name", async () => {
    api.on("GET", PROFILE, json(200, profile(alice)));
    api.on("GET", POSTS, json(200, page([])));
    await renderSignedIn(<PublicProfile username="alice_92" />);

    expect(await screen.findByText("No posts yet")).toBeInTheDocument();
    expect(screen.getByText("When Alice Example posts, it will show up here.")).toBeInTheDocument();
  });

  it("explains a failure to load the posts, and keeps the profile", async () => {
    api.on("GET", PROFILE, json(200, profile(alice)));
    api.on("GET", POSTS, json(503, { detail: "Unavailable." }));
    await renderSignedIn(<PublicProfile username="alice_92" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load posts");
    expect(screen.getByRole("heading", { name: "Alice Example" })).toBeInTheDocument();
  });

  it("offers one's own profile for editing instead of following it", async () => {
    api.on("GET", `/users/${viewerAuthor.username}`, json(200, profile(viewerAuthor)));
    api.on("GET", `/users/${viewerAuthor.username}/posts`, json(200, page([])));
    await renderSignedIn(<PublicProfile username={viewerAuthor.username} />);

    expect(await screen.findByRole("link", { name: "Edit profile" })).toHaveAttribute("href", "/profile");
    expect(screen.queryByRole("button", { name: /^Follow/ })).not.toBeInTheDocument();
  });

  it("shows a visitor without a session neither following nor editing", async () => {
    api.on("GET", PROFILE, json(200, profile(alice)));
    api.on("GET", POSTS, json(200, page([])));
    await renderSignedOut(<PublicProfile username="alice_92" />);

    expect(await screen.findByRole("heading", { name: "Alice Example" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Follow/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit profile" })).not.toBeInTheDocument();
  });
});

describe("Following from a profile", () => {
  it("follows, then shows the counts the backend has afterwards", async () => {
    api.on("POST", FOLLOW, json(200, { following: true }));
    const { user, button } = await setupFollowing(
      false,
      json(200, profile(alice, { following: true, followers_count: 4 })),
    );
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    const following = await screen.findByRole("button", { name: "Following" });
    expect(following).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(details()).toHaveTextContent("4 Followers"));
    expect(api.calls("GET", PROFILE)).toHaveLength(2);
  });

  it("unfollows", async () => {
    api.on("DELETE", FOLLOW, json(200, { following: false }));
    const { user, button } = await setupFollowing(
      true,
      json(200, profile(alice, { following: false, followers_count: 2 })),
    );

    await user.click(button);

    expect(await screen.findByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(details()).toHaveTextContent("2 Followers"));
  });

  it.each([
    ["a server error", json(500, { detail: "Internal server error." }), "Something went wrong. Please try again."],
    ["an account that is gone", json(404, { detail: "User not found." }), "This account is no longer available."],
  ])("keeps the button as it was and explains %s", async (_, reply, message) => {
    api.on("POST", FOLLOW, reply);
    const { user, button } = await setupFollowing(false);

    await user.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Follow" })).toBeEnabled();
    expect(api.calls("GET", PROFILE)).toHaveLength(1);
  });

  it("sends one request, however often it is pressed at the same moment", async () => {
    const answer = deferred();
    api.on("POST", FOLLOW, answer.reply);
    const { button } = await setupFollowing(false, json(200, profile(alice, { following: true })));

    act(() => {
      button.click();
      button.click();
    });

    expect(api.calls("POST", FOLLOW)).toHaveLength(1);
    expect(button).toBeDisabled();
    await act(() => answer.respond(json(200, { following: true })));
    expect(await screen.findByRole("button", { name: "Following" })).toBeEnabled();
    expect(api.calls("POST", FOLLOW)).toHaveLength(1);
  });

  it("lets go of the user when the session has ended", async () => {
    api.on("POST", FOLLOW, json(401, { detail: "Not authenticated." }));
    const { user, button } = await setupFollowing(false);

    await user.click(button);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(screen.queryByRole("button", { name: /^Follow/ })).not.toBeInTheDocument();
  });
});
