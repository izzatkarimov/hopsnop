import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import { connection } from "next/server";
import { AuthProvider } from "@/components/auth/auth-provider";
import "./globals.css";

// Weight axis only: its default optical size (14) and width (100) are the ones we use.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

// Only recovery codes and the two-factor key use it, so it isn't preloaded.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  preload: false,
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
  themeColor: "#0f0e0e",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Rendered per request, so scripts carry this response's CSP nonce (see proxy.ts).
  await connection();

  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${jetbrainsMono.variable} antialiased`}
    >
      <body className="dot-grid min-h-dvh bg-bg font-sans text-body text-primary">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
