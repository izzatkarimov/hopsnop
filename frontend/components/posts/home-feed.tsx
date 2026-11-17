"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useCurrentUser } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/layout/page-header";
import { StoryTray } from "@/components/stories/story-tray";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  SegmentedControl,
  segmentPanelId,
  segmentTabId,
} from "@/components/ui/segmented-control";
import { getFollowingFeed, getForYouFeed } from "@/lib/feed";
import { firstName, greeting } from "@/lib/format";
import { FeedPanel, PostNotice } from "./feed-panel";
import { useNewPost } from "./new-post";
import { useFeed } from "./use-feed";
import { usePostActions } from "./use-post-actions";

type TabId = "for-you" | "following";

const tabs = [
  { id: "for-you", label: "For you" },
  { id: "following", label: "Following" },
] as const;

const TABS_ID = "feed";

const noChanges = () => () => {};

/** By this device's clock, so never in the server render. */
function useGreeting(name: string): string {
  return useSyncExternalStore(
    noChanges,
    () => greeting(name, new Date()),
    () => "",
  );
}

/** A post can be in both feeds, so changes (usePostActions) apply to both. */
export function HomeFeed() {
  const viewer = useCurrentUser();
  const name = firstName(viewer);
  const hello = useGreeting(name);
  const newPost = useNewPost();
  const [activeTab, setActiveTab] = useState<TabId>("for-you");
  const [followingOpened, setFollowingOpened] = useState(false);

  const forYou = useFeed(getForYouFeed, true);
  const following = useFeed(getFollowingFeed, followingOpened);
  const { handlers, notice } = usePostActions([forYou, following]);

  // Published from the dialog, here or on another page: shown at the top of For you.
  const { published, clearPublished } = newPost;
  const [seenPublished, setSeenPublished] = useState(published);
  if (published !== seenPublished) {
    setSeenPublished(published);
    if (published.length > 0) setActiveTab("for-you");
  }
  useEffect(() => {
    if (published.length === 0) return;
    for (const post of [...published].reverse()) forYou.addPost(post);
    clearPublished();
  }, [published, clearPublished, forYou]);

  function changeTab(tabId: TabId) {
    if (tabId === "following") setFollowingOpened(true);
    setActiveTab(tabId);
  }

  return (
    <>
      <PageHeader
        title="Home"
        eyebrow={hello}
        actions={
          <SegmentedControl
            label="Feed"
            idPrefix={TABS_ID}
            segments={tabs}
            value={activeTab}
            onChange={changeTab}
          />
        }
      />

      <PostNotice notice={notice} />

      <Card surface="shell">
        <StoryTray />

        <button
          type="button"
          aria-haspopup="dialog"
          onClick={newPost.open}
          className="flex w-full items-center gap-3 rounded-tile py-3 pr-3 pl-4 text-left surface-tile focus-ring motion-safe:transition hover:brightness-110"
        >
          <Avatar user={viewer} />
          <span className="min-w-0 flex-1 truncate text-body text-muted">
            What&apos;s new, {name}?
          </span>
          {/* Looks like the dialog's button; the whole tile is the button. */}
          <span
            aria-hidden="true"
            className={`inline-flex h-9 shrink-0 items-center rounded-full px-4 text-control font-semibold ${buttonVariants.primary}`}
          >
            Post
          </span>
        </button>

        <Card
          as="section"
          role="tabpanel"
          id={segmentPanelId(TABS_ID, activeTab)}
          aria-labelledby={segmentTabId(TABS_ID, activeTab)}
          className="py-1"
        >
          {activeTab === "for-you" ? (
            <FeedPanel feed={forYou} handlers={handlers} />
          ) : (
            <FeedPanel
              feed={following}
              handlers={handlers}
              empty={
                <EmptyState
                  title="Your Following feed is empty"
                  description="When people you follow post, their posts will appear here."
                />
              }
            />
          )}
        </Card>
      </Card>
    </>
  );
}
