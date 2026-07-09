"use client";

import { Suspense, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/src/auth/auth-client";

const PRIVATE_SERVER_MESSAGE =
  "This is a private server. Your Google account is not on its allowlist.";

const buttonStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.75rem 1.5rem",
  background: "#7fd8b4",
  color: "#0d0d0d",
  fontFamily: "inherit",
  fontWeight: 600,
  fontSize: "1rem",
  letterSpacing: "0.05em",
  border: "1px solid #7fd8b4",
  cursor: "pointer",
};

function SignInForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (searchParams.get("error")) {
      setError(PRIVATE_SERVER_MESSAGE);
    }
  }, [searchParams]);

  // When better-auth's MCP OAuth flow needs a login, it redirects here with
  // the ORIGINAL authorize query params (client_id, redirect_uri, state,
  // code_challenge, ...). After Google sign-in we must send the user back to
  // the authorize endpoint with those exact params so the flow can resume and
  // issue the code to the MCP client. Plain visits fall back to redirect_to/"/".
  const callbackURL = searchParams.get("client_id")
    ? `/api/auth/mcp/authorize?${searchParams.toString()}`
    : (searchParams.get("redirect_to") ?? "/");

  async function handleSignIn() {
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
      if (result?.error) {
        setError(PRIVATE_SERVER_MESSAGE);
        setPending(false);
      }
    } catch {
      setError(PRIVATE_SERVER_MESSAGE);
      setPending(false);
    }
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ letterSpacing: "0.05em" }}>SHAUGHV HEALTH MCP</h1>
      <p>Sign in to continue.</p>

      <p>
        <button
          type="button"
          onClick={handleSignIn}
          disabled={pending}
          style={buttonStyle}
        >
          Continue with Google
        </button>
      </p>

      {error ? (
        <p style={{ color: "#f2b8b5" }}>{error}</p>
      ) : null}

      <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>
        Access is limited to allowlisted Google accounts.
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
