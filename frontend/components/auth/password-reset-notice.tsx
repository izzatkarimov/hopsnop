"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Notice } from "@/components/ui/notice";

const PARAM = "password_reset";
const DONE = "done";

export const LOGIN_AFTER_PASSWORD_RESET = `/login?${PARAM}=${DONE}`;

/** Taken out of the URL at once, so a reload or bookmark doesn't repeat the note. */
export function PasswordResetNotice() {
  const flagged = useSearchParams().get(PARAM) === DONE;
  // Read once, so the note stays after the parameter leaves the URL.
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
