export function postHref(postId: string): string {
  return `/posts/${encodeURIComponent(postId)}`;
}

export function profileHref(username: string): string {
  return `/users/${encodeURIComponent(username)}`;
}

/** The plain address of a post on this site, with nothing added to it. */
export function postUrl(postId: string): string {
  return new URL(postHref(postId), window.location.origin).href;
}

/** False when the browser has no clipboard here or refuses the write. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText !== "function") return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/** The system share sheet where there is one, otherwise the link is copied. */
export async function sharePost(postId: string, authorName: string): Promise<ShareResult> {
  const url = postUrl(postId);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: `Post by ${authorName} on Hopsnop`, url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Refused for another reason: copying still works.
    }
  }
  return (await copyToClipboard(url)) ? "copied" : "failed";
}
