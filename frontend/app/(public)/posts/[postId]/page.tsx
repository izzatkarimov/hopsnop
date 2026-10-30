import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { PostThread } from "@/components/posts/post-thread";

export const metadata: Metadata = { title: "Post" };

type PostPageProps = {
  params: Promise<{ postId: string }>;
};

export default async function PostPage({ params }: PostPageProps) {
  // Whatever was typed; PostThread only asks the API for a post id's shape.
  const { postId } = await params;

  return (
    <>
      <PageHeader title="Post" />
      {/* Each post gets its own state, so no stale replies show while loading. */}
      <PostThread key={postId} postId={postId} />
    </>
  );
}
