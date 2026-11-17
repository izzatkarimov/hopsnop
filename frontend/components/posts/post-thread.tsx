"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useHasNavigated } from "@/components/layout/navigation-history";
import { PageHeader } from "@/components/layout/page-header";
import { FollowButton } from "@/components/profile/follow-button";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { IconArrowLeft } from "@/components/ui/icons";
import { TextLink } from "@/components/ui/text-link";
import { unexpectedErrorMessage } from "@/lib/api";
import { createPost, getPost, listReplies } from "@/lib/posts";
import { getFollowStatus } from "@/lib/profiles";
import type { Post } from "@/lib/types";
import { FeedPanel, PostNotice } from "./feed-panel";
import { postHref } from "./links";
import { PostItem } from "./post-item";
import { PostSkeleton } from "./post-skeleton";
import { ReplyComposer } from "./reply-composer";
import { useFeed } from "./use-feed";
import { usePostActions } from "./use-post-actions";
import type { PostContainer, PostHandlers } from "./use-post-actions";

type Loaded =
  | { status: "loading" }
  /** One backend answer for missing, deleted and hidden: they can't be told apart. */
  | { status: "unavailable" }
  /** The request failed; the post may well exist. */
  | { status: "error"; message: string }
  | { status: "ready"; post: Post };

function useLoadedPost(postId: string | null, attempt: number) {
  const [state, setState] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    if (postId === null) return;
    // Set by the cleanup, so a stale request can't change the state.
    let ignore = false;

    getPost(postId).then(
      (post) => {
        if (ignore) return;
        setState(post ? { status: "ready", post } : { status: "unavailable" });
      },
      (error: unknown) => {
        if (ignore) return;
        setState({ status: "error", message: unexpectedErrorMessage(error) });
      },
    );

    return () => {
      ignore = true;
    };
  }, [postId, attempt]);

  const container: PostContainer = {
    posts: state.status === "ready" ? [state.post] : [],
    updatePosts(change) {
      setState((current) => {
        if (current.status !== "ready") return current;
        const [post] = change([current.post]);
        return post ? { status: "ready", post } : { status: "unavailable" };
      });
    },
  };

  return { state, setState, container };
}

/** Back within the site when the tab came from here, otherwise Home. */
function BackButton() {
  const router = useRouter();
  const navigated = useHasNavigated();

  return (
    <IconButton
      label="Back"
      icon={<IconArrowLeft />}
      variant="secondary"
      size="lg"
      onClick={() => (navigated ? router.back() : router.push("/"))}
    />
  );
}

/** Shows only the backend's answer; nothing while it's unknown or couldn't be had. */
function AuthorFollow({ username }: { username: string }) {
  const [following, setFollowing] = useState<boolean | null>(null);

  useEffect(() => {
    let ignore = false;
    getFollowStatus(username).then(
      (answer) => {
        if (!ignore) setFollowing(answer);
      },
      () => {
        if (!ignore) setFollowing(null);
      },
    );
    return () => {
      ignore = true;
    };
  }, [username]);

  if (following === null) return null;
  return <FollowButton username={username} following={following} onChange={setFollowing} />;
}

/** A visitor is asked to log in; the backend refuses a reply without a session. */
export function PostThread({ postId }: { postId: string }) {
  const auth = useAuth();
  const viewer = auth.status === "authenticated" ? auth.user : null;
  const [attempt, setAttempt] = useState(0);
  const [parentAttempt, setParentAttempt] = useState(0);

  const main = useLoadedPost(postId, attempt);
  const post = main.state.status === "ready" ? main.state.post : null;
  const parentId = post?.parentPostId ?? null;
  const parent = useLoadedPost(parentId, parentAttempt);

  const loadReplies = useCallback(
    (cursor?: string | null) => listReplies(postId, { cursor }),
    [postId],
  );
  // Not before the post is known: a hidden post has no replies to ask for.
  const replies = useFeed(loadReplies, post !== null);

  const { handlers, notice } = usePostActions([
    main.container,
    parent.container,
    replies,
  ]);

  async function reply(content: string) {
    replies.addPost(await createPost(content, postId));
  }

  const header = (
    <PageHeader
      title="Post"
      eyebrow={post?.author.displayName ?? ""}
      leading={viewer ? <BackButton /> : undefined}
    />
  );

  if (main.state.status === "loading") {
    return (
      <>
        {header}
        <Card surface="shell">
          <Card role="status">
            <span className="sr-only">Loading post…</span>
            <PostSkeleton />
          </Card>
        </Card>
      </>
    );
  }

  if (main.state.status === "error") {
    return (
      <>
        {header}
        <Card role="alert">
          <EmptyState
            title="Couldn't load this post"
            description={main.state.message}
            action={
              <Button
                variant="primary"
                onClick={() => {
                  main.setState({ status: "loading" });
                  setAttempt((current) => current + 1);
                }}
              >
                Try again
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  if (main.state.status === "unavailable") {
    return (
      <>
        {header}
        <PostNotice notice={notice} />
        <Card>
          <EmptyState
            title="This post is unavailable"
            description="It may have been deleted, or the link may be wrong."
            action={
              // Home needs a session: a visitor would only be sent on to the login page.
              viewer ? (
                <ButtonLink href="/" variant="primary">
                  Go to Home
                </ButtonLink>
              ) : (
                <ButtonLink href="/login" variant="primary">
                  Log in
                </ButtonLink>
              )
            }
          />
        </Card>
      </>
    );
  }

  const isOwnPost = viewer !== null && viewer.id === main.state.post.author.id;

  return (
    <>
      {header}
      <PostNotice notice={notice} />

      <Card surface="shell">
        {parentId !== null && (
          <Card>
            <ParentPost
              parentId={parentId}
              state={parent.state}
              handlers={handlers}
              onRetry={() => {
                parent.setState({ status: "loading" });
                setParentAttempt((current) => current + 1);
              }}
            />
          </Card>
        )}

        <Card>
          <PostItem
            post={main.state.post}
            handlers={handlers}
            replyHref="#reply"
            layout="detail"
            authorAction={
              viewer && !isOwnPost ? (
                <AuthorFollow username={main.state.post.author.username} />
              ) : undefined
            }
          />
        </Card>

        <Card id="reply" className="scroll-mt-6">
          {viewer ? (
            <ReplyComposer viewer={viewer} onSubmit={reply} />
          ) : (
            <p className="px-4 py-3 text-body">
              <TextLink href="/login">Log in to reply</TextLink>
            </p>
          )}
        </Card>

        <Card as="section" aria-label="Replies" className="py-1">
          <FeedPanel
            feed={replies}
            handlers={handlers}
            errorTitle="Couldn't load replies"
            empty={<EmptyState title="No replies yet" description="Be the first to reply." />}
          />
        </Card>
      </Card>
    </>
  );
}

type ParentPostProps = {
  parentId: string;
  state: Loaded;
  handlers: PostHandlers;
  onRetry: () => void;
};

function ParentPost({ parentId, state, handlers, onRetry }: ParentPostProps) {
  if (state.status === "loading") {
    return (
      <div role="status">
        <span className="sr-only">Loading the post this replies to…</span>
        <PostSkeleton />
      </div>
    );
  }

  if (state.status === "ready") {
    return <PostItem post={state.post} handlers={handlers} />;
  }

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-body text-secondary">
      {state.status === "unavailable" ? (
        "This is a reply to a post that was deleted or is no longer available."
      ) : (
        <>
          <span role="alert">Couldn&apos;t load the post this replies to.</span>
          <Button variant="ghost" onClick={onRetry}>
            Try again
          </Button>
          <TextLink href={postHref(parentId)}>Open it</TextLink>
        </>
      )}
    </p>
  );
}
