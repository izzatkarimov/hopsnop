import { Wordmark } from "@/components/ui/wordmark";

/**
 * Layout for the pages used while signed out: log in, register, email
 * verification and password reset. A route group of its own, so it does not
 * get the app shell.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>
        <main id="main-content">{children}</main>
      </div>
    </div>
  );
}
