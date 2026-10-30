import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, deferred, json, ZIP_BYTES, zip } from "@/test/api";
import { authState, renderSignedIn } from "@/test/render";
import { ExportSection } from "./export-section";

const PASSWORD = "my password 123";
const FILENAME = "hopsnop-export-test_viewer-2026-10-19.zip";
const BLOB_URL = "blob:http://localhost/0d1b2c3e";

let downloads: { name: string; href: string }[];

beforeEach(() => {
  downloads = [];
  // jsdom has no object URLs, and cannot download anything.
  URL.createObjectURL = vi.fn(() => BLOB_URL);
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  });
});

afterEach(() => {
  // Back to what jsdom has: neither.
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

function exportReply() {
  return zip(FILENAME);
}

async function setup() {
  await renderSignedIn(<ExportSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Download your data" }));
  return {
    user,
    password: screen.getByLabelText("Password"),
    submit: screen.getByRole("button", { name: "Download" }),
  };
}

const exportRequests = () => api.calls("POST", "/users/me/export");

describe("ExportSection", () => {
  it("asks for the password first, and Cancel sends nothing", async () => {
    const { user, password } = await setup();
    expect(password).toHaveFocus();

    await user.type(password, PASSWORD);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download your data" })).toHaveFocus();
    expect(exportRequests()).toEqual([]);
  });

  it("refuses to send without a password", async () => {
    const { user, password, submit } = await setup();

    await user.click(submit);

    expect(password).toHaveAccessibleDescription("Enter your password.");
    expect(exportRequests()).toEqual([]);
  });

  it("hands the browser the file exactly as sent, under the server's name", async () => {
    api.on("POST", "/users/me/export", exportReply());
    const { user, password, submit } = await setup();
    await user.type(password, PASSWORD);

    await user.click(submit);

    expect(await screen.findByText(`Your download has started: ${FILENAME}`)).toBeInTheDocument();
    expect(exportRequests().map((call) => call.body)).toEqual([{ password: PASSWORD }]);
    expect(downloads).toEqual([{ name: FILENAME, href: BLOB_URL }]);
    const [blob] = vi.mocked(URL.createObjectURL).mock.calls[0];
    expect(new Uint8Array(await (blob as Blob).arrayBuffer())).toEqual(ZIP_BYTES);
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download your data" })).toHaveFocus();
  });

  it("lets go of the file's object URL once the browser has had time to take it", async () => {
    api.on("POST", "/users/me/export", exportReply());
    const { user, password, submit } = await setup();
    await user.type(password, PASSWORD);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    fireEvent.submit(submit.closest("form")!);
    await act(() => new Promise((resolve) => setImmediate(resolve)));
    expect(downloads).toHaveLength(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  it("shows a wrong password on the field, and saves nothing", async () => {
    api.on("POST", "/users/me/export", json(400, { detail: "Current password is incorrect." }));
    const { user, password, submit } = await setup();
    await user.type(password, "wrong password");

    await user.click(submit);

    await waitFor(() => expect(password).toHaveAccessibleDescription("Your password is incorrect."));
    expect(password).toHaveFocus();
    expect(downloads).toEqual([]);
  });

  it.each([
    ["a server error", json(503, { detail: "Unavailable." }), "Something went wrong. Please try again."],
    [
      "the export limit",
      json(429, { detail: "Too many requests. Try again later." }, { "Retry-After": "900" }),
      "Too many attempts. Please wait about 15 minutes before trying again.",
    ],
  ])("explains %s, and saves nothing", async (_, reply, message) => {
    api.on("POST", "/users/me/export", reply);
    const { user, password, submit } = await setup();
    await user.type(password, PASSWORD);

    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(downloads).toEqual([]);
  });

  it("sends one request however often the form is submitted meanwhile", async () => {
    const answer = deferred();
    api.on("POST", "/users/me/export", answer.reply);
    const { user, password, submit } = await setup();
    await user.type(password, PASSWORD);
    const form = submit.closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(exportRequests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Preparing download…" })).toBeDisabled();

    await act(() => answer.respond(exportReply()));
    await screen.findByText(`Your download has started: ${FILENAME}`);
    expect(downloads).toHaveLength(1);
  });

  it("lets go of the user when the session has ended", async () => {
    api.on("POST", "/users/me/export", json(401, { detail: "Not authenticated." }));
    const { user, password, submit } = await setup();
    await user.type(password, PASSWORD);

    await user.click(submit);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(downloads).toEqual([]);
  });
});
