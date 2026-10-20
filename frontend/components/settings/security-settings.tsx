"use client";

import { useState } from "react";
import { PasswordSection } from "./password-section";
import { SessionsSection } from "./sessions-section";

/** The password and the sessions, which a password change affects. */
export function SecuritySettings() {
  // A password change ends every other session, so the list is loaded
  // again: a new key starts the sessions section afresh.
  const [sessionsKey, setSessionsKey] = useState(0);

  return (
    <>
      <PasswordSection onChanged={() => setSessionsKey((key) => key + 1)} />
      <SessionsSection key={sessionsKey} />
    </>
  );
}
