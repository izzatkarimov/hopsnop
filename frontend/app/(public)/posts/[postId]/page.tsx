import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { PostThread } from "@/components/posts/post-thread";

export const metadata: Metadata = { title: "Post" };

type PostPageProps = {
  params: Promise<{ postId: string }>;
};

export default async function PostPage({ params }: PostPageProps) {
  // Whatever was typed into the address bar. PostThread asks the API only
  // for a value that has the shape of a post id.
  const { postId } = await params;

  return (
    <>
      <PageHeader title="Post" />
      {/* The key gives each post its own state, so one post's replies are
          never shown while another's are loading. */}
      <PostThread key={postId} postId={postId} />
    </>
  );
}
