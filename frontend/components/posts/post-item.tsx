"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconBubble } from "@/components/ui/icons";
import { formatCount, formatFullDate, formatRelativeTime, formatTimestamp } from "@/lib/format";
import { isEdited } from "@/lib/posts";
import type { Post } from "@/lib/types";
import { postHref, profileHref, sharePost } from "./links";
import { PostActions } from "./post-actions";
import { PostContent } from "./post-content";
import { PostEditor } from "./post-editor";
import { PostMenu } from "./post-menu";
import type { PostHandlers } from "./use-post-actions";

const STATUS_MS = 4000;

type PostItemProps = {
  post: Post;
  handlers: PostHandlers;
  replyHref?: string;
  /** "detail": the post's own page, larger, with its full time and counts. */
  layout?: "row" | "detail";
  /** Next to the author, e.g. a follow button. */
  authorAction?: ReactNode;
};

export function PostItem({
  post,
  handlers,
  replyHref,
  layout = "row",
  authorAction,
}: PostItemProps) {
  const { author } = post;
  const { viewerId } = handlers;
  const isOwnPost = viewerId !== null && author.id === viewerId;
  const actionError = handlers.actionErrors[post.id];
  const detail = layout === "detail";

  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  // A ref: `deleting` only changes on the next render.
  const deleteInFlight = useRef(false);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), STATUS_MS);
    return () => clearTimeout(timer);
  }, [status]);

  async function confirmDelete() {
    if (deleteInFlight.current) return;

    deleteInFlight.current = true;
    setDeleting(true);
    setDeleteError(null);
    // Resolves with null once the post is gone, and this with it.
    const error = await handlers.onDelete(post.id);
    deleteInFlight.current = false;
    setDeleting(false);
    setDeleteError(error);
  }

  async function share() {
    const result = await sharePost(post.id, author.displayName);
    if (result === "copied") setStatus("Link copied.");
    if (result === "failed") setStatus("Couldn't share or copy the link: this browser didn't allow it.");
  }

  const menu = (
    <PostMenu
      post={post}
      isOwnPost={isOwnPost}
      onStatus={setStatus}
      onEdit={isOwnPost && handlers.canEdit(post) ? () => setMode("edit") : undefined}
      onDelete={
        isOwnPost
          ? () => {
              setDeleteError(null);
              setMode("confirm-delete");
            }
          : undefined
      }
    />
  );

  const time = (
    <time dateTime={post.createdAt} title={formatFullDate(post.createdAt)} suppressHydrationWarning>
      {detail ? formatTimestamp(post.createdAt) : formatRelativeTime(post.createdAt)}
    </time>
  );

  const edited = isEdited(post) && (
    <span title={`Edited ${formatFullDate(post.updatedAt)}`} className="shrink-0 text-muted">
      <span aria-hidden="true">· </span>Edited
    </span>
  );

  const avatar = (
    // Pointer only: keyboard and screen readers reach the profile by name.
    <Link
      href={profileHref(author.username)}
      tabIndex={-1}
      aria-hidden="true"
      className="shrink-0 self-start rounded-full"
    >
      <Avatar user={author} size={detail ? "post" : "md"} />
    </Link>
  );

  const body =
    mode === "edit" ? (
      <PostEditor
        post={post}
        onSave={(content) => handlers.onEdit(post.id, content)}
        onClose={() => setMode("view")}
      />
    ) : (
      <div className={detail ? "text-lead text-primary" : "text-body text-primary"}>
        <PostContent content={post.content} />
      </div>
    );

  const footer = (
    <div className="flex flex-col gap-1">
      {mode === "confirm-delete" && (
        <div
          role="group"
          aria-label="Delete post"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !deleting) setMode("view");
          }}
          className="flex flex-wrap items-center justify-end gap-2 pt-2"
        >
          <p className="mr-auto text-body text-primary">
            Delete this post? This can&apos;t be undone.
          </p>
          <Button autoFocus onClick={() => setMode("view")} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      )}

      {(deleteError ?? actionError) && (
        <p role="alert" className="text-meta font-medium text-danger">
          {deleteError ?? actionError}
        </p>
      )}
      <p aria-live="polite" className="text-meta font-medium text-secondary">
        {status}
      </p>
    </div>
  );

  const actions = (
    <PostActions
      post={post}
      replyHref={replyHref ?? postHref(post.id)}
      layout={layout}
      disabled={viewerId === null}
      onToggleLike={() => handlers.onToggleLike(post.id)}
      onToggleRepost={() => handlers.onToggleRepost(post.id)}
      onShare={share}
    />
  );

  if (detail) {
    return (
      <article aria-label={`Post by ${author.displayName}`} className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          {avatar}
          <Link
            href={profileHref(author.username)}
            className="group flex min-w-0 flex-1 flex-col text-body"
          >
            <span className="truncate font-semibold text-primary group-hover:underline">
              {author.displayName}
            </span>
            <span className="truncate text-muted">@{author.username}</span>
          </Link>
          {authorAction}
          {menu}
        </div>

        {body}

        <p className="flex flex-wrap gap-1 text-meta font-medium text-muted">
          {time}
          {edited}
        </p>

        <p className="flex flex-wrap gap-x-6 gap-y-1 border-y border-edge/6 py-3 text-body">
          <span>
            <span className="font-semibold text-primary">{formatCount(post.likeCount)}</span>{" "}
            <span className="text-muted">{post.likeCount === 1 ? "like" : "likes"}</span>
          </span>
          <span>
            <span className="font-semibold text-primary">{formatCount(post.repostCount)}</span>{" "}
            <span className="text-muted">{post.repostCount === 1 ? "repost" : "reposts"}</span>
          </span>
        </p>

        <div className="flex flex-col">
          {actions}
          {footer}
        </div>
      </article>
    );
  }

  return (
    <article
      aria-label={`Post by ${author.displayName}`}
      className="relative flex gap-3 p-4 not-last:after:absolute not-last:after:inset-x-4 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-edge/6"
    >
      {avatar}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 text-body">
          <div className="flex min-w-0 flex-1 items-baseline gap-1">
            <Link
              href={profileHref(author.username)}
              className="group flex min-w-0 items-baseline gap-2"
            >
              <span className="truncate font-semibold text-primary group-hover:underline">
                {author.displayName}
              </span>
              <span className="truncate text-muted">@{author.username}</span>
            </Link>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            {/* The clock differs between server render and hydration. */}
            <Link href={postHref(post.id)} className="shrink-0 text-muted hover:underline">
              {time}
            </Link>
            {edited}
          </div>
          {menu}
        </div>

        {post.parentPostId && (
          // Whether it still exists is found out by going there.
          <Link
            href={postHref(post.parentPostId)}
            className="inline-flex items-center gap-1 self-start text-meta font-medium text-muted hover:underline"
          >
            <IconBubble size={16} />
            Replying to a post
          </Link>
        )}

        {body}
        <div className="flex flex-col">
          {actions}
          {footer}
        </div>
      </div>
    </article>
  );
}
