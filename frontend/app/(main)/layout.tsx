import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
