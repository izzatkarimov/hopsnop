import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/test/api";
import { RECOVERY_CODES } from "@/test/fixtures";
import { renderSignedIn } from "@/test/render";
import { RECOVERY_CODES_FILENAME, RecoveryCodes } from "./recovery-codes";

const BLOB_URL = "blob:http://localhost/5e7a90c1";

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
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

async function setup() {
  const onClose = vi.fn();
  await renderSignedIn(<RecoveryCodes codes={RECOVERY_CODES} onClose={onClose} />);
  return { user: userEvent.setup(), onClose };
}

const requestsBeyondTheSessionCheck = () => api.calls().filter((call) => call.path !== "/auth/me");

describe("RecoveryCodes", () => {
  it("shows every code, kept from page translation, with the heading focused", async () => {
    await setup();

    expect(screen.getByRole("heading", { name: "Save your recovery codes" })).toHaveFocus();
    const list = screen.getByRole("list", { name: "Recovery codes" });
    expect(list).toHaveAttribute("translate", "no");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(RECOVERY_CODES);
    expect(screen.getByText(/They're shown only this once\./)).toBeInTheDocument();
  });

  it("copies all the codes, one per line", async () => {
    const { user } = await setup();

    await user.click(screen.getByRole("button", { name: "Copy all" }));

    expect(await navigator.clipboard.readText()).toBe(RECOVERY_CODES.join("\n"));
    expect(screen.getByText("Copied.")).toHaveAttribute("role", "status");
  });

  it("says so when the browser refuses to copy, and logs nothing", async () => {
    const { user } = await setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied."));
    const consoles = (["log", "warn", "error"] as const).map((method) => vi.spyOn(console, method));

    await user.click(screen.getByRole("button", { name: "Copy all" }));

    expect(await screen.findByText("Couldn't copy. Select the text and copy it yourself.")).toBeInTheDocument();
    for (const spy of consoles) expect(spy).not.toHaveBeenCalled();
  });

  it("downloads the codes as a text file made in the browser, sending nothing", async () => {
    const { user } = await setup();

    await user.click(screen.getByRole("button", { name: "Download as a text file" }));

    expect(downloads).toEqual([{ name: RECOVERY_CODES_FILENAME, href: BLOB_URL }]);
    expect(RECOVERY_CODES_FILENAME).toBe("hopsnop-recovery-codes.txt");
    const [blob] = vi.mocked(URL.createObjectURL).mock.calls[0] as [Blob];
    expect(blob.type).toBe("text/plain;charset=utf-8");
    const text = await blob.text();
    expect(text).toContain("Hopsnop recovery codes for @test_viewer");
    for (const code of RECOVERY_CODES) expect(text).toContain(`\n${code}\n`);
    expect(requestsBeyondTheSessionCheck()).toEqual([]);
  });

  it("can't be closed until the user says the codes are saved", async () => {
    const { user, onClose } = await setup();
    const saved = screen.getByRole("checkbox", { name: "I've saved these codes" });

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(saved).toHaveFocus();
    expect(saved).toHaveAccessibleDescription("Confirm that you've saved your recovery codes.");
    expect(screen.getAllByRole("listitem")).toHaveLength(RECOVERY_CODES.length);

    await user.click(saved);
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
