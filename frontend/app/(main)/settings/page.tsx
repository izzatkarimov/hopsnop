import type { Metadata } from "next";
import { LogoutButton } from "@/components/auth/logout-button";
import { PageHeader } from "@/components/layout/page-header";
import { DeleteAccountSection } from "@/components/settings/delete-account-section";
import { ExportSection } from "@/components/settings/export-section";
import { SecuritySettings } from "@/components/settings/security-settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <SecuritySettings />
      <ExportSection />
      <section
        aria-labelledby="logout-heading"
        className="flex flex-col items-start gap-3 border-b border-border px-4 py-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id="logout-heading" className="text-lg font-semibold">
            Log out
          </h2>
          <p className="text-body text-muted">
            End your session in this browser.
          </p>
        </div>
        <LogoutButton variant="button" />
      </section>
      <DeleteAccountSection />
    </>
  );
}
