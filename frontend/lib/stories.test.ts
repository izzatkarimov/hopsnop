import { describe, expect, it } from "vitest";
import { api, json, noContent } from "@/test/api";
import { alice, bob, story, storyId, storyPage, viewerAuthor } from "@/test/fixtures";
import { account } from "@/test/render";
import {
  STORY_CAPTION_MAX_LENGTH,
  createStory,
  deleteStory,
  getStory,
  groupStories,
  listStories,
  recordStoryView,
  toStory,
  validateStoryCaption,
} from "./stories";

const FIRST_PAGE = "/stories?limit=50";

function pagePath(cursor: string) {
  return `/stories?limit=50&cursor=${cursor}`;
}

describe("listStories", () => {
  it("maps the backend's stories to the app's", async () => {
    const answer = story(1, alice, { caption: "Good morning", viewed_by_me: true });
    api.on("GET", FIRST_PAGE, json(200, storyPage([answer])));

    await expect(listStories()).resolves.toEqual([
      {
        id: storyId(1),
        author: { username: alice.username, displayName: alice.display_name, avatarUrl: null },
        mediaUrl: `/stories/${storyId(1)}/media`,
        mediaType: "image",
        mediaWidth: 1080,
        mediaHeight: 1440,
        caption: "Good morning",
        createdAt: answer.created_at,
        expiresAt: answer.expires_at,
        viewedByViewer: true,
        viewCount: null,
      },
    ]);
  });

  it("asks for one page after another, 50 at a time, until the last", async () => {
    api.on("GET", FIRST_PAGE, json(200, storyPage([story(1, alice)], "page-2")));
    api.on("GET", pagePath("page-2"), json(200, storyPage([story(2, bob)])));

    const stories = await listStories();

    expect(stories.map((item) => item.id)).toEqual([storyId(1), storyId(2)]);
    expect(api.calls("GET").map((call) => call.path)).toEqual([FIRST_PAGE, pagePath("page-2")]);
  });

  it("stops after five pages", async () => {
    api.on("GET", FIRST_PAGE, json(200, storyPage([story(1, alice)], "page-2")));
    for (let n = 2; n <= 5; n++) {
      api.on("GET", pagePath(`page-${n}`), json(200, storyPage([story(n, alice)], `page-${n + 1}`)));
    }

    const stories = await listStories();

    expect(stories).toHaveLength(5);
    expect(api.calls("GET")).toHaveLength(5);
  });

  it("lists a story once when two pages both have it", async () => {
    api.on("GET", FIRST_PAGE, json(200, storyPage([story(1, alice)], "page-2")));
    api.on("GET", pagePath("page-2"), json(200, storyPage([story(1, alice), story(2, bob)])));

    const stories = await listStories();

    expect(stories.map((item) => item.id)).toEqual([storyId(1), storyId(2)]);
  });

  it.each([
    ["no list", { next_cursor: null }],
    ["a cursor that is not text", { items: [], next_cursor: 2 }],
    ["an entry that is not a story", { items: [null], next_cursor: null }],
    ["a story without an author", { items: [{ ...story(1, alice), author: null }], next_cursor: null }],
    ["a picture without a size", { items: [{ ...story(1, alice), media_width: 0 }], next_cursor: null }],
    ["an unreadable date", { items: [{ ...story(1, alice), expires_at: "tomorrow" }], next_cursor: null }],
    ["a view count that is not a number", { items: [{ ...story(1, alice), view_count: "3" }], next_cursor: null }],
    ["no viewed flag", { items: [{ ...story(1, alice), viewed_by_me: undefined }], next_cursor: null }],
  ])("refuses an answer with %s", async (_, body) => {
    api.on("GET", FIRST_PAGE, json(200, body));

    await expect(listStories()).rejects.toMatchObject({ kind: "server" });
  });
});

describe("getStory", () => {
  it("returns the story while it is shown", async () => {
    api.on("GET", `/stories/${storyId(1)}`, json(200, story(1, alice)));

    await expect(getStory(storyId(1))).resolves.toMatchObject({ id: storyId(1) });
  });

  it("returns null once the backend no longer shows it", async () => {
    api.on("GET", `/stories/${storyId(1)}`, json(404, { detail: "Story not found." }));

    await expect(getStory(storyId(1))).resolves.toBeNull();
  });
});

describe("createStory", () => {
  const picture = new File([new Uint8Array(10)], "me.jpg", { type: "image/jpeg" });

  it("sends the picture and the trimmed caption as a form, and returns the story", async () => {
    api.on("POST", "/stories", json(201, story(1, viewerAuthor, { caption: "Good morning" })));

    await expect(createStory(picture, "  Good morning  ")).resolves.toMatchObject({
      id: storyId(1),
      caption: "Good morning",
    });

    const [call] = api.calls("POST", "/stories");
    const form = call.body as FormData;
    expect(form.get("image")).toBe(picture);
    expect(form.get("caption")).toBe("Good morning");
    expect(call.init.headers).toBeUndefined();
  });

  it("sends no caption for a blank one", async () => {
    api.on("POST", "/stories", json(201, story(1, viewerAuthor)));

    await createStory(picture, "   ");

    const form = api.calls("POST", "/stories")[0].body as FormData;
    expect([...form.keys()]).toEqual(["image"]);
  });
});

describe("recordStoryView", () => {
  it("says whether the backend recorded the view", async () => {
    api.on("POST", `/stories/${storyId(1)}/view`, json(200, { viewed: true }));

    await expect(recordStoryView(storyId(1))).resolves.toBe(true);
  });

  it.each([{}, { viewed: "yes" }, null])("refuses the answer %j", async (body) => {
    api.on("POST", `/stories/${storyId(1)}/view`, json(200, body));

    await expect(recordStoryView(storyId(1))).rejects.toMatchObject({ kind: "server" });
  });
});

describe("deleteStory", () => {
  it("addresses the story by its id", async () => {
    api.on("DELETE", `/stories/${storyId(1)}`, noContent());

    await deleteStory(storyId(1));

    expect(api.calls("DELETE")).toHaveLength(1);
  });
});

describe("validateStoryCaption", () => {
  it("accepts no caption, and one of up to 150 characters, an emoji counting as one", () => {
    expect(validateStoryCaption("")).toBeNull();
    expect(validateStoryCaption("   ")).toBeNull();
    expect(validateStoryCaption("👋".repeat(STORY_CAPTION_MAX_LENGTH))).toBeNull();
    expect(validateStoryCaption(`  ${"a".repeat(STORY_CAPTION_MAX_LENGTH)}  `)).toBeNull();
  });

  it("refuses a longer caption, and a character the backend cannot store", () => {
    expect(validateStoryCaption("a".repeat(STORY_CAPTION_MAX_LENGTH + 1))).toBe(
      "Use at most 150 characters.",
    );
    expect(validateStoryCaption("a\0b")).toBe(
      "This caption contains a character that can't be posted.",
    );
  });
});

describe("groupStories", () => {
  it("puts one's own first, then the others by their newest story, each oldest first", () => {
    const stories = [
      story(1, bob),
      story(2, alice),
      story(3, viewerAuthor),
      story(4, bob),
      story(5, alice),
    ].map(toStory);

    const groups = groupStories(stories, account.username);

    expect(groups.map((group) => [group.author.username, group.stories.map((item) => item.id)])).toEqual([
      [account.username, [storyId(3)]],
      [bob.username, [storyId(4), storyId(1)]],
      [alice.username, [storyId(5), storyId(2)]],
    ]);
    expect(groups.map((group) => group.isOwn)).toEqual([true, false, false]);
  });

  it("tells which authors have stories not viewed yet, which one's own never are", () => {
    const stories = [
      story(1, alice, { viewed_by_me: true }),
      story(2, alice),
      story(3, bob, { viewed_by_me: true }),
      story(4, viewerAuthor),
    ].map(toStory);

    const groups = groupStories(stories, account.username);

    expect(groups.map((group) => [group.author.username, group.hasUnviewed])).toEqual([
      [account.username, false],
      [alice.username, true],
      [bob.username, false],
    ]);
  });
});
