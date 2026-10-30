import { describe, expect, it } from "vitest";
import { api, html, json, ZIP_BYTES, zip } from "@/test/api";
import { downloadAccountExport } from "./export";

const NAME = "hopsnop-export-alice_92-2026-10-19.zip";

describe("downloadAccountExport", () => {
  it("sends the password and keeps the archive exactly as it arrived", async () => {
    api.on("POST", "/users/me/export", zip(NAME));

    const file = await downloadAccountExport("my password");

    expect(api.calls("POST", "/users/me/export")[0].body).toEqual({ password: "my password" });
    expect(new Uint8Array(await file.blob.arrayBuffer())).toEqual(ZIP_BYTES);
  });

  it("uses the server's file name", async () => {
    api.on("POST", "/users/me/export", zip(NAME));

    expect((await downloadAccountExport("pw")).filename).toBe(NAME);
  });

  it.each([
    ["no name", null],
    ["a name of another type", "hopsnop-export.html"],
  ])("falls back to a plain name for an answer with %s", async (_, filename) => {
    api.on("POST", "/users/me/export", zip(filename));

    expect((await downloadAccountExport("pw")).filename).toBe("hopsnop-export.zip");
  });

  it("keeps a name that could name a folder from doing so", async () => {
    api.on("POST", "/users/me/export", zip("../../hopsnop-export.zip"));

    expect((await downloadAccountExport("pw")).filename).not.toContain("/");
  });

  it.each([
    ["an error page", html(200)],
    ["a JSON document", json(200, { export_version: 1 })],
    ["nothing", zip(NAME, new Uint8Array())],
  ])("refuses %s in place of an archive", async (_, reply) => {
    api.on("POST", "/users/me/export", reply);

    await expect(downloadAccountExport("pw")).rejects.toMatchObject({ kind: "server" });
  });
});
