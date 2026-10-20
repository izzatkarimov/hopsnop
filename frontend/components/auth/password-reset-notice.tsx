"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Notice } from "@/components/ui/notice";

/** How the reset page tells the login page that the reset worked. */
const PARAM = "password_reset";
const DONE = "done";

/** Where the user is sent once their password has been reset. */
export const LOGIN_AFTER_PASSWORD_RESET = `/login?${PARAM}=${DONE}`;

/**
 * Tells the user on the login page that their password has been reset.
 *
 * The note is for the visit that follows the reset only: the parameter is
 * taken out of the URL at once, so a reload or a bookmark does not show it
 * again. It says no more than the backend guarantees for a reset: every
 * session of the account has been ended, and no new one has been started.
 */
export function PasswordResetNotice() {
  const flagged = useSearchParams().get(PARAM) === DONE;
  // Read once, so that the note stays after the parameter has left the URL.
  const [shown] = useState(flagged);

  useEffect(() => {
    if (flagged) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [flagged]);

  if (!shown) return null;
  return (
    <Notice tone="info">
      Your password has been reset and you&apos;ve been logged out on all
      devices. Log in with your new password.
    </Notice>
  );
}
