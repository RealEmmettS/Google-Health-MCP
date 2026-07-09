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
      style={{
        padding: "0.4rem 0.9rem",
        background: "transparent",
        color: "#f2f2f2",
        border: "1px solid #f2f2f2",
        fontFamily: "inherit",
        fontSize: "0.85rem",
        letterSpacing: "0.05em",
        cursor: "pointer",
      }}
    >
      Sign out
    </button>
  );
}
