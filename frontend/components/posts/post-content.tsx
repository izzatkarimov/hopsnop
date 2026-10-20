import { parsePostContent } from "@/lib/posts";

/**
 * Renders user-generated post text. Content is untrusted, so it is only ever
 * rendered as React text nodes (escaped), never as HTML.
 */
export function PostContent({ content }: { content: string }) {
  const segments = parsePostContent(content);

  return (
    <p className="whitespace-pre-wrap wrap-break-word leading-relaxed">
      {segments.map((segment, index) =>
        segment.type === "mention" ? (
          // Will become a profile link once profile routes exist.
          <span key={index} className="text-accent">
            @{segment.username}
          </span>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </p>
  );
}
