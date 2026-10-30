import { parsePostContent } from "@/lib/posts";

/** Untrusted: only ever rendered as React text nodes, never as HTML. */
export function PostContent({ content }: { content: string }) {
  const segments = parsePostContent(content);

  return (
    <p className="whitespace-pre-wrap wrap-break-word leading-relaxed">
      {segments.map((segment, index) =>
        segment.type === "mention" ? (
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
