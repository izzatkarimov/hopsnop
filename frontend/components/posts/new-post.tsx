"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "@/components/auth/auth-provider";
import type { Post } from "@/lib/types";
import { NewPostDialog } from "./new-post-dialog";

type NewPost = {
  open: () => void;
  /** Published here and not yet shown by Home, newest first. */
  published: Post[];
  clearPublished: () => void;
};

const NewPostContext = createContext<NewPost | null>(null);

/** The New post dialog, which the shell and Home's composer open. */
export function NewPostProvider({ children }: { children: ReactNode }) {
  const viewer = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [published, setPublished] = useState<Post[]>([]);
  const [announcement, setAnnouncement] = useState("");

  const open = useCallback(() => {
    setAnnouncement("");
    setIsOpen(true);
  }, []);
  const clearPublished = useCallback(() => setPublished([]), []);
  const value = useMemo(
    () => ({ open, published, clearPublished }),
    [open, published, clearPublished],
  );

  function handlePublished(post: Post) {
    setPublished((current) => [post, ...current]);
    setIsOpen(false);
    setAnnouncement("Your post was published.");
    // Home shows it at the top, however far its first page has got.
    if (pathname !== "/") router.push("/");
  }

  return (
    <NewPostContext value={value}>
      {children}
      {isOpen && (
        <NewPostDialog
          viewer={viewer}
          onClose={() => setIsOpen(false)}
          onPublished={handlePublished}
        />
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </NewPostContext>
  );
}

export function useNewPost(): NewPost {
  const value = useContext(NewPostContext);
  if (!value) {
    throw new Error("useNewPost must be used inside NewPostProvider.");
  }
  return value;
}
