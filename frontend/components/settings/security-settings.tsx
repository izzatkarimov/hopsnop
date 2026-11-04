"use client";

import { useState } from "react";
import { PasswordSection } from "./password-section";
import { SessionsSection } from "./sessions-section";
import { TwoFactorSection } from "./two-factor-section";

export function SecuritySettings() {
  // Password and two-factor changes end other sessions; a new key reloads the list.
  const [sessionsKey, setSessionsKey] = useState(0);
  const reloadSessions = () => setSessionsKey((key) => key + 1);

  return (
    <>
      <PasswordSection onChanged={reloadSessions} />
      <TwoFactorSection onChanged={reloadSessions} />
      <SessionsSection key={sessionsKey} />
    </>
  );
}
