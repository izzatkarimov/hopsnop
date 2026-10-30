"use client";

import { useState } from "react";
import { PasswordSection } from "./password-section";
import { SessionsSection } from "./sessions-section";

export function SecuritySettings() {
  // A password change ends other sessions; a new key reloads the list.
  const [sessionsKey, setSessionsKey] = useState(0);

  return (
    <>
      <PasswordSection onChanged={() => setSessionsKey((key) => key + 1)} />
      <SessionsSection key={sessionsKey} />
    </>
  );
}
