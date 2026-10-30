import { EmptyState } from "@/components/ui/empty-state";
import type { Post } from "@/lib/types";
import { PostItem } from "./post-item";
import type { PostHandlers } from "./use-post-actions";

type PostListProps = {
  posts: Post[];
  handlers: PostHandlers;
};

export function PostList({ posts, handlers }: PostListProps) {
  if (posts.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="When posts are shared, they will show up here."
      />
    );
  }

  return (
    <div>
      {posts.map((post) => (
        <PostItem key={post.id} post={post} handlers={handlers} />
      ))}
    </div>
  );
}
