import type { Metadata } from "next";
import { HomeFeed } from "@/components/posts/home-feed";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return <HomeFeed />;
}
