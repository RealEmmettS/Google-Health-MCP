"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/src/auth/auth-client";

const PRIVATE_SERVER_MESSAGE =
  "This is a private server. Your Google account is not on its allowlist.";

export function GoogleSignInButton({
  callbackURL,
  initialError = false,
  label = "Sign in with Google",
}: {
  callbackURL: string;
  initialError?: boolean;
  label?: string;
}) {
  const [error, setError] = useState<string | null>(
    initialError ? PRIVATE_SERVER_MESSAGE : null,
  );
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setError(initialError ? PRIVATE_SERVER_MESSAGE : null);
  }, [initialError]);

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
    <div className="sign-in-action">
      <button
        type="button"
        onClick={handleSignIn}
        disabled={pending}
        aria-busy={pending}
        className="button button-primary button-large"
      >
        {pending ? "Opening Google" : label}
      </button>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
