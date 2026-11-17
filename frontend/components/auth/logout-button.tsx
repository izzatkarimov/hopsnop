"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { IconDoor } from "@/components/ui/icons";
import { useAuth } from "./auth-provider";

type LogoutButtonProps = {
  variant: "icon" | "button";
};

export function LogoutButton({ variant }: LogoutButtonProps) {
  const { logOut } = useAuth();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    setPending(true);
    setFailed(false);
    try {
      await logOut();
    } catch {
      // The session may still be alive, so the user stays signed in and is told.
      setFailed(true);
      setPending(false);
    }
  }

  if (variant === "icon") {
    return (
      <>
        <IconButton
          label="Log out"
          title="Log out"
          icon={<IconDoor />}
          onClick={handleClick}
          disabled={pending}
        />
        {/* A full line of its own in the wrapping row it sits in. */}
        {failed && (
          <p role="alert" className="basis-full text-center text-meta font-medium text-danger lg:text-left">
            Couldn&apos;t log out. Try again.
          </p>
        )}
      </>
    );
  }

  return (
    <span className="flex flex-col items-center gap-2">
      <Button onClick={handleClick} disabled={pending}>
        {pending ? "Logging out…" : "Log out"}
      </Button>
      {failed && (
        <span role="alert" className="text-meta font-medium text-danger">
          Couldn&apos;t log out. Try again.
        </span>
      )}
    </span>
  );
}
