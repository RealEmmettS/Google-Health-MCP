"use client";

import { authClient } from "@/src/auth/auth-client";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        window.location.href = "/";
      }}
      className="button button-secondary sign-out-button"
    >
      Sign out
    </button>
  );
}
