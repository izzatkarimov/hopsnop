"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { ReplyIcon } from "@/components/ui/icons";
import { formatFullDate, formatRelativeTime } from "@/lib/format";
import { isEdited } from "@/lib/posts";
import type { Post } from "@/lib/types";
import { PostActions } from "./post-actions";
import { PostContent } from "./post-content";
import { PostEditor } from "./post-editor";
import { PostMenu } from "./post-menu";
import type { PostHandlers } from "./use-post-actions";

/** Where a post's own page is. The id is the only thing that names a post. */
export function postHref(postId: string): string {
  return `/posts/${encodeURIComponent(postId)}`;
}

/** Where a user's public profile is. */
export function profileHref(username: string): string {
  return `/users/${encodeURIComponent(username)}`;
}

type PostItemProps = {
  post: Post;
  handlers: PostHandlers;
  /**
   * Where the reply control leads. The post's own page unless given, which
   * is where a reply to it is written.
   */
  replyHref?: string;
};

/** A single post in a list. A reply is shown as the post it is. */
export function PostItem({ post, handlers, replyHref }: PostItemProps) {
  const { author } = post;
  const { viewerId } = handlers;
  const isOwnPost = viewerId !== null && author.id === viewerId;
  const actionError = handlers.actionErrors[post.id];

  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Guards against asking twice. A ref, because it changes at once:
  // `deleting` only changes when React next renders.
  const deleteInFlight = useRef(false);

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

  return (
    <article
      aria-label={`Post by ${author.displayName}`}
      className="flex gap-3 border-b border-border px-4 pt-3 pb-1"
    >
      {/* The same link as the author's name, for the pointer only: keyboard
          and screen reader users reach the profile once, by name. */}
      <Link
        href={profileHref(author.username)}
        tabIndex={-1}
        aria-hidden="true"
        className="shrink-0 self-start rounded-full"
      >
        <Avatar user={author} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-body">
          <div className="flex min-w-0 flex-1 items-baseline gap-1">
            <Link
              href={profileHref(author.username)}
              className="group flex min-w-0 items-baseline gap-1"
            >
              <span className="truncate font-semibold group-hover:underline">
                {author.displayName}
              </span>
              <span className="truncate text-muted">@{author.username}</span>
            </Link>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            {/* Relative time depends on the current clock, which differs
                between server render and hydration. */}
            <Link
              href={postHref(post.id)}
              className="shrink-0 text-muted hover:underline"
            >
              <time
                dateTime={post.createdAt}
                title={formatFullDate(post.createdAt)}
                suppressHydrationWarning
              >
                {formatRelativeTime(post.createdAt)}
              </time>
            </Link>
            {isEdited(post) && (
              <span
                title={`Edited ${formatFullDate(post.updatedAt)}`}
                className="shrink-0 text-muted"
              >
                <span aria-hidden="true">· </span>Edited
              </span>
            )}
          </div>
          <PostMenu
            content={post.content}
            onEdit={
              isOwnPost && handlers.canEdit(post)
                ? () => setMode("edit")
                : undefined
            }
            onDelete={
              isOwnPost
                ? () => {
                    setDeleteError(null);
                    setMode("confirm-delete");
                  }
                : undefined
            }
          />
        </div>

        {post.parentPostId && (
          // Only where the post it answers is. Whether that post is still
          // there is found out by going there.
          <Link
            href={postHref(post.parentPostId)}
            className="inline-flex items-center gap-1 text-sm text-muted hover:underline"
          >
            <ReplyIcon width={14} height={14} />
            Replying to a post
          </Link>
        )}

        {mode === "edit" ? (
          <PostEditor
            post={post}
            onSave={(content) => handlers.onEdit(post.id, content)}
            onClose={() => setMode("view")}
          />
        ) : (
          <div className="mt-0.5 text-body">
            <PostContent content={post.content} />
          </div>
        )}

        <PostActions
          post={post}
          replyHref={replyHref ?? postHref(post.id)}
          // Liking and reposting need a session.
          disabled={viewerId === null}
          onToggleLike={() => handlers.onToggleLike(post.id)}
          onToggleRepost={() => handlers.onToggleRepost(post.id)}
        />

        {mode === "confirm-delete" && (
          <div
            role="group"
            aria-label="Delete post"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !deleting) setMode("view");
            }}
            className="flex flex-wrap items-center justify-end gap-2 pb-2"
          >
            <p className="mr-auto text-sm">
              Delete this post? This can&apos;t be undone.
            </p>
            <button
              type="button"
              autoFocus
              onClick={() => setMode("view")}
              disabled={deleting}
              className="rounded-full border border-border px-4 py-1 text-sm font-semibold transition-colors hover:bg-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="rounded-full border border-danger/40 px-4 py-1 text-sm font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}

        {(deleteError ?? actionError) && (
          <p role="alert" className="pb-2 text-sm text-danger">
            {deleteError ?? actionError}
          </p>
        )}
      </div>
    </article>
  );
}
