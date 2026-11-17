import { Wordmark } from "@/components/ui/wordmark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-clip px-4 py-4 sm:px-12 sm:py-8">
      <div
        aria-hidden="true"
        className="glow pointer-events-none absolute top-1/2 left-1/2 -z-10 h-180 w-240 -translate-1/2"
      />
      <div className="flex">
        <Wordmark />
      </div>
      <main
        id="main-content"
        className="flex flex-1 flex-col items-center justify-center py-10"
      >
        {children}
      </main>
      <footer className="text-center text-meta font-medium text-muted">
        © {new Date().getFullYear()} Hopsnop
      </footer>
    </div>
  );
}
