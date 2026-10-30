import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { PublicProfile } from "@/components/profile/public-profile";
import { isUsername } from "@/lib/auth-validation";

type UserProfilePageProps = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({
  params,
}: UserProfilePageProps): Promise<Metadata> {
  const { username } = await params;
  // Whatever was typed; used as a title only if it has a username's shape.
  return {
    title: isUsername(username) ? `@${username.toLowerCase()}` : "Profile",
  };
}

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const { username } = await params;

  return (
    <>
      <PageHeader title="Profile" />
      {/* Each profile gets its own state, so no stale details show while loading. */}
      <PublicProfile key={username} username={username} />
    </>
  );
}
