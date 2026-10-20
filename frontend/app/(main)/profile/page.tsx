import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { OwnProfile } from "@/components/profile/own-profile";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" />
      <OwnProfile />
    </>
  );
}
