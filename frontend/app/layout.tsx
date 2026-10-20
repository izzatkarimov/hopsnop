import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { AuthProvider } from "@/components/auth/auth-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s · Hopsnop",
    default: "Hopsnop",
  },
  description: "Hopsnop — a secure, content-focused social platform.",
};

export const viewport: Viewport = {
  // Lets the mobile bottom navigation respect the device safe area.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page is rendered for the request it answers, not ahead of time,
  // so that its scripts can carry that response's Content-Security-Policy
  // nonce (see proxy.ts). A page built in advance would have none, and the
  // policy would block its scripts.
  await connection();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="bg-background font-sans text-foreground">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
