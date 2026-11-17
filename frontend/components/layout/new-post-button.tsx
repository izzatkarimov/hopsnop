"use client";

import { useNewPost } from "@/components/posts/new-post";
import { buttonVariants } from "@/components/ui/button";
import { IconPlus } from "@/components/ui/icons";

type NewPostButtonProps = {
  placement: "sidebar" | "bottom-bar";
};

/* Full class names are listed so Tailwind can detect them. */
const placements = {
  // A round button on the 72px rail, the full-width pill from 1024px.
  sidebar: "size-10 lg:w-full lg:px-4",
  "bottom-bar": "size-12",
};

/** Opens the New post dialog, on any page. */
export function NewPostButton({ placement }: NewPostButtonProps) {
  const { open } = useNewPost();

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={open}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-control font-semibold focus-ring motion-safe:transition ${buttonVariants.primary} ${placements[placement]}`}
    >
      <IconPlus size={placement === "bottom-bar" ? 24 : 20} />
      <span className={placement === "sidebar" ? "sr-only lg:not-sr-only" : "sr-only"}>
        New post
      </span>
    </button>
  );
}
