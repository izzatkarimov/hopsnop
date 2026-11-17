"use client";

import { usePathname, useRouter } from "next/navigation";
import { useComposeRequest } from "@/components/posts/compose-request";
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

/** Opens Home's composer, from any page. */
export function NewPostButton({ placement }: NewPostButtonProps) {
  const compose = useComposeRequest();
  const router = useRouter();
  const pathname = usePathname();

  function handleClick() {
    compose?.request();
    if (pathname !== "/") router.push("/");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-control font-semibold focus-ring motion-safe:transition ${buttonVariants.primary} ${placements[placement]}`}
    >
      <IconPlus size={placement === "bottom-bar" ? 24 : 20} />
      <span className={placement === "sidebar" ? "sr-only lg:not-sr-only" : "sr-only"}>
        New post
      </span>
    </button>
  );
}
