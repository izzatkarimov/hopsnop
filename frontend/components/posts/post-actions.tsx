import type { ComponentType } from "react";
import Link from "next/link";
import {
  IconBubble,
  IconHeart,
  IconHeartFilled,
  IconRepost,
  IconShare,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";
import { formatCount } from "@/lib/format";
import type { Post } from "@/lib/types";

/* Full class names are listed so Tailwind can detect them. */

const pillClass =
  "inline-flex shrink-0 items-center gap-1 rounded-full text-meta tabular-nums focus-ring motion-safe:transition-colors disabled:cursor-default disabled:opacity-60";

const layouts = {
  // In a list: counts beside the icons.
  row: { bar: "flex items-center gap-1 pt-1", pill: "px-2 py-1" },
  // A post's own page: the counts are in the stats line above.
  detail: { bar: "flex items-center justify-between px-6", pill: "p-2" },
};

const idleClass = "font-medium text-muted not-disabled:hover:bg-edge/6 not-disabled:hover:text-primary";

const pressedClass = {
  repost: "bg-success/12 font-semibold text-success",
  like: "bg-like/12 font-semibold text-like",
};

type ActionButtonProps = {
  label: string;
  count?: number;
  icon: ComponentType<IconProps>;
  pressedIcon?: ComponentType<IconProps>;
  tone: keyof typeof pressedClass;
  pressed: boolean;
  layout: keyof typeof layouts;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
};

function ActionButton({
  label,
  count,
  icon: Icon,
  pressedIcon: PressedIcon = Icon,
  tone,
  pressed,
  layout,
  disabled,
  title,
  onClick,
}: ActionButtonProps) {
  const Glyph = pressed ? PressedIcon : Icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      className={`${pillClass} ${layouts[layout].pill} ${pressed ? pressedClass[tone] : idleClass}`}
    >
      <Glyph />
      <span className="sr-only">
        {label}
        {count !== undefined && ", "}
      </span>
      {count !== undefined && <span>{formatCount(count)}</span>}
    </button>
  );
}

type PostActionsProps = {
  post: Post;
  replyHref: string;
  layout?: keyof typeof layouts;
  /** No likes or reposts without a session. */
  disabled?: boolean;
  onToggleLike: () => void;
  onToggleRepost: () => void;
  onShare: () => void;
};

export function PostActions({
  post,
  replyHref,
  layout = "row",
  disabled,
  onToggleLike,
  onToggleRepost,
  onShare,
}: PostActionsProps) {
  const signInHint = disabled ? "Log in to like or repost" : undefined;
  const showCounts = layout === "row";

  return (
    <div className={layouts[layout].bar}>
      {/* A link: replying happens on the post's page. No reply count exists. */}
      <Link
        href={replyHref}
        aria-label="Reply"
        className={`${pillClass} ${layouts[layout].pill} ${idleClass}`}
      >
        <IconBubble />
      </Link>
      <ActionButton
        label="Repost"
        count={showCounts ? post.repostCount : undefined}
        icon={IconRepost}
        tone="repost"
        pressed={post.repostedByViewer}
        layout={layout}
        disabled={disabled}
        title={signInHint}
        onClick={onToggleRepost}
      />
      <ActionButton
        label="Like"
        count={showCounts ? post.likeCount : undefined}
        icon={IconHeart}
        pressedIcon={IconHeartFilled}
        tone="like"
        pressed={post.likedByViewer}
        layout={layout}
        disabled={disabled}
        title={signInHint}
        onClick={onToggleLike}
      />
      <button
        type="button"
        aria-label="Share"
        onClick={onShare}
        className={`${pillClass} ${layouts[layout].pill} ${idleClass}`}
      >
        <IconShare />
      </button>
    </div>
  );
}
