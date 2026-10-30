import { AuthSwitch } from "@/components/auth/auth-switch";
import { AppShell } from "@/components/layout/app-shell";
import { GuestShell } from "@/components/layout/guest-shell";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <AuthSwitch
      authenticated={<AppShell>{children}</AppShell>}
      guest={<GuestShell>{children}</GuestShell>}
    />
  );
}
