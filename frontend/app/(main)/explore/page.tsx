import type { Metadata } from "next";
import { UserLookup } from "@/components/explore/user-lookup";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return (
    <>
      <PageHeader title="Explore" />
      <UserLookup />
    </>
  );
}
