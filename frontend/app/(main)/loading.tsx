import { PostSkeleton } from "@/components/posts/post-skeleton";

export default function MainLoading() {
  return (
    <div role="status">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: 5 }, (_, index) => (
        <PostSkeleton key={index} />
      ))}
    </div>
  );
}
