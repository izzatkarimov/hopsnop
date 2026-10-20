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
  // The segment is whatever was typed into the address bar. It is only used
  // as a title when it has the shape of a username.
  return {
    title: isUsername(username) ? `@${username.toLowerCase()}` : "Profile",
  };
}

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const { username } = await params;

  return (
    <>
      <PageHeader title="Profile" />
      {/* The key gives each profile its own state, so one user's details are
          never shown while another's are loading. */}
      <PublicProfile key={username} username={username} />
    </>
  );
}
