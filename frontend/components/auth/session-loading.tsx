import { LogoMark } from "@/components/ui/wordmark";

export function SessionLoading() {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center">
      <LogoMark className="text-primary motion-safe:animate-pulse" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
