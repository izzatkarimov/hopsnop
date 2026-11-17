import type { Metadata } from "next";
import { UserLookup } from "@/components/explore/user-lookup";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <>
      <PageHeader title="Search" />
      <UserLookup />
    </>
  );
}
