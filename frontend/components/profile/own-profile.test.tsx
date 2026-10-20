import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/auth/require-auth";
import { SidebarAccount } from "@/components/layout/sidebar-account";
import type { MyProfileResponse } from "@/lib/profiles";
import { API_URL, api, deferred, json } from "@/test/api";
import { page } from "@/test/fixtures";
import { account, authState, renderSignedIn } from "@/test/render";
import { OwnProfile } from "./own-profile";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const OLD_PICTURE = `/users/${account.username}/avatar/0b6f1c3e-6a51-4c71-9a4a-0f1f2b3c4d5e`;
const NEW_PICTURE = `/users/${account.username}/avatar/7d2e9a10-3b4c-4d5e-8f60-718293a4b5c6`;
const PREVIEW = "blob:http://localhost/preview";

beforeEach(() => {
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => PREVIEW);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

function photo(name = "me.jpg", type = "image/jpeg", size = 1000): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** The addresses of the pictures shown, by their alt text or place. */
function pictureSources(): string[] {
  return Array.from(document.querySelectorAll("img"), (image) => image.getAttribute("src") ?? "");
}

function me(extra: Partial<MyProfileResponse> = {}): MyProfileResponse {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    email_verified_at: account.email_verified_at,
    display_name: account.display_name,
    bio: "Old bio",
    avatar_url: OLD_PICTURE,
    followers_count: 3,
    following_count: 1,
    created_at: account.created_at,
    ...extra,
  };
}

/** The page as it is used: inside the signed-in shell, whose sidebar names the user. */
async function setup(...profileReplies: Parameters<typeof api.on>[2][]) {
  api.on("GET", "/users/me", ...(profileReplies.length ? profileReplies : [json(200, me())]));
  api.on("GET", `/users/${account.username}/posts`, json(200, page([])));
  await renderSignedIn(
    <RequireAuth>
      <SidebarAccount />
      <OwnProfile />
    </RequireAuth>,
  );
  return { user: userEvent.setup() };
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Edit profile" }));
  return {
    displayName: screen.getByLabelText("Display name"),
    bio: screen.getByLabelText("Bio"),
    picture: screen.getByLabelText("Change picture") as HTMLInputElement,
    save: screen.getByRole("button", { name: "Save" }),
  };
}

const saves = () => api.calls("PATCH", "/users/me");
const uploads = () => api.calls("PUT", "/users/me/avatar");

describe("OwnProfile", () => {
  it("shows the signed-in user's own profile, with a way to edit it", async () => {
    await setup();

    expect(await screen.findByRole("heading", { name: "Test Viewer" })).toBeInTheDocument();
    expect(screen.getByText("Old bio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  });

  it("explains a failure to load, and loads again on request", async () => {
    await setup(json(503, { detail: "Unavailable." }), json(200, me()));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your profile");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Test Viewer" })).toBeInTheDocument();
  });

  it("lets go of the user when the profile cannot be read without a session", async () => {
    await setup(json(401, { detail: "Not authenticated." }));

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(router.replace).toHaveBeenCalledWith("/login");
  });
});

describe("Editing one's profile", () => {
  it("sends only what changed, and shows the saved profile here and in the sidebar", async () => {
    api.on("PATCH", "/users/me", json(200, me({ display_name: "New Name" })));
    const { user } = await setup();
    const { displayName, save } = await openEditor(user);
    expect(save).toBeDisabled();

    await user.clear(displayName);
    await user.type(displayName, "  New Name ");
    await user.click(save);

    expect(await screen.findByRole("heading", { name: "New Name" })).toBeInTheDocument();
    // Untouched fields are not sent, so nothing else can be overwritten.
    expect(saves().map((call) => call.body)).toEqual([{ display_name: "New Name" }]);
    expect(screen.getByText("Signed in as New Name")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Profile updated.");
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
  });

  it("clears exactly the bio that was emptied", async () => {
    api.on("PATCH", "/users/me", json(200, me({ bio: null })));
    const { user } = await setup();
    const { bio, save } = await openEditor(user);

    await user.clear(bio);
    await user.click(save);

    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].body).toEqual({ bio: null });
  });

  it("has nothing to save while the values only differ by surrounding spaces", async () => {
    const { user } = await setup();
    const { displayName, save } = await openEditor(user);

    await user.type(displayName, "  ");

    expect(save).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(saves()).toEqual([]);
  });

  it("checks the display name and the bio's length before sending", async () => {
    const { user } = await setup();
    const { displayName, bio, save } = await openEditor(user);

    await user.clear(displayName);
    await user.clear(bio);
    await user.click(bio);
    await user.paste("b".repeat(161));
    await user.click(save);

    expect(displayName).toHaveAccessibleDescription("Enter a display name.");
    expect(bio).toHaveAccessibleDescription("Use at most 160 characters.");
    expect(displayName).toHaveFocus();
    expect(saves()).toEqual([]);
  });

  it("shows the backend's refusal on its field", async () => {
    api.on(
      "PATCH",
      "/users/me",
      json(422, { detail: [{ loc: ["body", "display_name"], msg: "Value error, Use letters, numbers or symbols.", type: "value_error" }] }),
    );
    const { user } = await setup();
    const { displayName, save } = await openEditor(user);

    await user.type(displayName, "!");
    await user.click(save);

    await waitFor(() => expect(displayName).toHaveAccessibleDescription("Use letters, numbers or symbols."));
    expect(displayName).toHaveFocus();
  });

  it("keeps what was typed and explains a failure", async () => {
    api.on("PATCH", "/users/me", json(500, { detail: "Internal server error." }));
    const { user } = await setup();
    const { bio, save } = await openEditor(user);

    await user.type(bio, " and more");
    await user.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(bio).toHaveValue("Old bio and more");
    expect(screen.getByText("Signed in as Test Viewer")).toBeInTheDocument();
  });

  it("saves once, however often it is sent at the same moment", async () => {
    const answer = deferred();
    api.on("PATCH", "/users/me", answer.reply);
    const { user } = await setup();
    const { bio, save } = await openEditor(user);
    await user.type(bio, "!");
    const form = save.closest("form")!;

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(saves()).toHaveLength(1);
    await act(() => answer.respond(json(200, me({ bio: "Old bio!" }))));
    expect(await screen.findByText("Old bio!")).toBeInTheDocument();
  });

  it("lets go of the user when saving finds the session ended", async () => {
    api.on("PATCH", "/users/me", json(401, { detail: "Not authenticated." }));
    const { user } = await setup();
    const { bio } = await openEditor(user);
    await user.type(bio, "!");

    fireEvent.submit(bio.closest("form")!);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});

describe("Changing one's picture", () => {
  it("shows the chosen picture at once and uploads it as a form when saved", async () => {
    api.on("PUT", "/users/me/avatar", json(200, me({ avatar_url: NEW_PICTURE })));
    const { user } = await setup();
    const { picture, save } = await openEditor(user);
    const file = photo();

    await user.upload(picture, file);

    expect(screen.getByAltText("Preview of the chosen picture")).toHaveAttribute("src", PREVIEW);
    expect(uploads()).toEqual([]);
    await user.click(save);

    await waitFor(() => expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument());
    const [upload] = uploads();
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get("image")).toBe(file);
    // The browser writes the multipart Content-Type, with its boundary.
    expect(upload.init.headers).toBeUndefined();
    // Nothing else changed, so nothing else is sent.
    expect(saves()).toEqual([]);
    // Here and in the sidebar, from the API.
    expect(pictureSources()).toEqual([`${API_URL}${NEW_PICTURE}`, `${API_URL}${NEW_PICTURE}`]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(PREVIEW);
  });

  it("sends the picture first and then the text that changed", async () => {
    api.on("PUT", "/users/me/avatar", json(200, me({ avatar_url: NEW_PICTURE })));
    api.on("PATCH", "/users/me", json(200, me({ avatar_url: NEW_PICTURE, bio: "New bio" })));
    const { user } = await setup();
    const { picture, bio, save } = await openEditor(user);

    await user.upload(picture, photo());
    await user.clear(bio);
    await user.type(bio, "New bio");
    await user.click(save);

    expect(await screen.findByText("New bio")).toBeInTheDocument();
    const writes = api.calls().filter((call) => call.method !== "GET");
    expect(writes.map((call) => `${call.method} ${call.path}`)).toEqual([
      "PUT /users/me/avatar",
      "PATCH /users/me",
    ]);
    expect(saves()[0].body).toEqual({ bio: "New bio" });
  });

  it("removes the picture, and shows the initials", async () => {
    api.on("DELETE", "/users/me/avatar", json(200, me({ avatar_url: null })));
    const { user } = await setup();
    const { save } = await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Remove picture" }));
    expect(screen.queryByRole("button", { name: "Remove picture" })).not.toBeInTheDocument();
    await user.click(save);

    await waitFor(() => expect(api.calls("DELETE", "/users/me/avatar")).toHaveLength(1));
    await waitFor(() => expect(pictureSources()).toEqual([]));
  });

  it.each([
    ["a file that is not a picture", photo("notes.txt", "text/plain"), "Choose a JPEG, PNG or WebP picture."],
    ["a picture larger than 10 MB", photo("big.jpg", "image/jpeg", 10 * 1024 * 1024 + 1), "Choose a picture of at most 10 MB."],
  ])("refuses %s before sending anything", async (_, file, message) => {
    const user = userEvent.setup({ applyAccept: false });
    api.on("GET", "/users/me", json(200, me()));
    api.on("GET", `/users/${account.username}/posts`, json(200, page([])));
    await renderSignedIn(<OwnProfile />);
    const { picture, save } = await openEditor(user);

    await user.upload(picture, file);

    expect(picture).toHaveAccessibleDescription(message);
    expect(save).toBeDisabled();
    expect(uploads()).toEqual([]);
  });

  it("shows the backend's refusal of the file, and keeps the form", async () => {
    api.on(
      "PUT",
      "/users/me/avatar",
      json(422, { detail: "The file is not a JPEG, PNG or WebP picture that can be read." }),
    );
    const { user } = await setup();
    const { picture, save } = await openEditor(user);

    await user.upload(picture, photo());
    await user.click(save);

    await waitFor(() =>
      expect(picture).toHaveAccessibleDescription(
        "The file is not a JPEG, PNG or WebP picture that can be read.",
      ),
    );
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(saves()).toEqual([]);
  });

  it("asks for a verified address before a picture is added", async () => {
    api.on("PUT", "/users/me/avatar", json(403, { detail: "Email address is not verified." }));
    const { user } = await setup();
    const { picture, save } = await openEditor(user);

    await user.upload(picture, photo());
    await user.click(save);

    await waitFor(() =>
      expect(picture).toHaveAccessibleDescription("Verify your email address before adding a picture."),
    );
  });

  it("keeps a picture that was saved when the text then is not", async () => {
    api.on("PUT", "/users/me/avatar", json(200, me({ avatar_url: NEW_PICTURE })));
    api.on("PATCH", "/users/me", json(500, { detail: "Internal server error." }));
    const { user } = await setup();
    const { picture, bio, save } = await openEditor(user);

    await user.upload(picture, photo());
    await user.type(bio, "!");
    await user.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(uploads()).toHaveLength(1);
    // Leaving the form shows the profile as it is now saved.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(pictureSources()).toEqual([`${API_URL}${NEW_PICTURE}`, `${API_URL}${NEW_PICTURE}`]);
  });
});
