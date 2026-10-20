import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Layout for signed-in product pages.
 * Lives in a route group so that other pages (log in, register) can do
 * without it. RequireAuth sends signed-out visitors to the login page.
 */
export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
