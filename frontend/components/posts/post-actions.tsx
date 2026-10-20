import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { HeartIcon, ReplyIcon, RepostIcon } from "@/components/ui/icons";
import { formatCount } from "@/lib/format";
import type { Post } from "@/lib/types";

// Full class names are listed so Tailwind can detect them.
const tones = {
  accent: {
    active: "text-accent",
    hover: "hover:text-accent",
    iconHover: "group-hover:bg-accent/10",
  },
  like: {
    active: "text-like",
    hover: "hover:text-like",
    iconHover: "group-hover:bg-like/10",
  },
};

type ActionButtonProps = {
  label: string;
  /** Left out for an action the backend keeps no count of. */
  count?: number;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: keyof typeof tones;
  /** Toggle state; omit for non-toggle actions. */
  pressed?: boolean;
  /** Fill the icon while pressed (e.g. a solid heart when liked). */
  fillWhenPressed?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
};

function ActionButton({
  label,
  count,
  icon: Icon,
  tone,
  pressed,
  fillWhenPressed,
  disabled,
  title,
  onClick,
}: ActionButtonProps) {
  const { active, hover, iconHover } = tones[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      className={`group flex items-center gap-0.5 rounded-full text-sm tabular-nums transition-colors disabled:cursor-default disabled:opacity-60 ${
        pressed ? active : ""
      } ${disabled ? "" : hover}`}
    >
      <span
        className={`rounded-full p-2 transition-colors ${disabled ? "" : iconHover}`}
      >
        <Icon
          width={18}
          height={18}
          fill={pressed && fillWhenPressed ? "currentColor" : "none"}
        />
      </span>
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
  /** Where a reply to the post is written. */
  replyHref: string;
  /** For a visitor without a session, who can neither like nor repost. */
  disabled?: boolean;
  onToggleLike: () => void;
  onToggleRepost: () => void;
};

export function PostActions({
  post,
  replyHref,
  disabled,
  onToggleLike,
  onToggleRepost,
}: PostActionsProps) {
  const signInHint = disabled ? "Log in to like or repost" : undefined;

  return (
    <div className="-ml-2 mt-1 flex max-w-md items-center justify-between text-muted">
      {/* A link, not a button: replying happens on the post's own page. The
          backend keeps no count of replies, so none is shown. */}
      <Link
        href={replyHref}
        aria-label="Reply"
        className={`group flex items-center rounded-full transition-colors ${tones.accent.hover}`}
      >
        <span
          className={`rounded-full p-2 transition-colors ${tones.accent.iconHover}`}
        >
          <ReplyIcon width={18} height={18} />
        </span>
      </Link>
      <ActionButton
        label="Repost"
        count={post.repostCount}
        icon={RepostIcon}
        tone="accent"
        pressed={post.repostedByViewer}
        disabled={disabled}
        title={signInHint}
        onClick={onToggleRepost}
      />
      <ActionButton
        label="Like"
        count={post.likeCount}
        icon={HeartIcon}
        tone="like"
        pressed={post.likedByViewer}
        fillWhenPressed
        disabled={disabled}
        title={signInHint}
        onClick={onToggleLike}
      />
    </div>
  );
}
