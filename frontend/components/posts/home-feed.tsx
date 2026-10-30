"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/layout/page-header";
import { StoryTray } from "@/components/stories/story-tray";
import { EmptyState } from "@/components/ui/empty-state";
import { getFollowingFeed, getForYouFeed } from "@/lib/feed";
import { createPost } from "@/lib/posts";
import { FeedPanel, PostNotice } from "./feed-panel";
import { FeedTabs, feedPanelId, feedTabId } from "./feed-tabs";
import { PostComposer } from "./post-composer";
import { useFeed } from "./use-feed";
import { usePostActions } from "./use-post-actions";

type TabId = "for-you" | "following";

const tabs: { id: TabId; label: string }[] = [
  { id: "for-you", label: "For you" },
  { id: "following", label: "Following" },
];

/** A post can be in both feeds, so changes (usePostActions) apply to both. */
export function HomeFeed() {
  const viewer = useCurrentUser();
  const [activeTab, setActiveTab] = useState<TabId>("for-you");
  const [followingOpened, setFollowingOpened] = useState(false);

  const forYou = useFeed(getForYouFeed, true);
  const following = useFeed(getFollowingFeed, followingOpened);
  const { handlers, notice } = usePostActions([forYou, following]);

  function changeTab(tabId: string) {
    if (tabId === "following") setFollowingOpened(true);
    setActiveTab(tabId === "following" ? "following" : "for-you");
  }

  async function publish(content: string) {
    // Not to Following: nobody's own posts are in that feed.
    forYou.addPost(await createPost(content));
  }

  return (
    <>
      <PageHeader title="Home">
        <FeedTabs tabs={tabs} activeTab={activeTab} onChange={changeTab} />
      </PageHeader>

      <StoryTray />
      <PostComposer viewer={viewer} onSubmit={publish} />
      <PostNotice notice={notice} />

      <section
        role="tabpanel"
        id={feedPanelId(activeTab)}
        aria-labelledby={feedTabId(activeTab)}
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
      </section>
    </>
  );
}
