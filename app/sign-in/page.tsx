"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BrandLoader, BrandLockup } from "../components/brand-elements";
import { GoogleSignInButton } from "../components/google-sign-in-button";

function SignInForm() {
  const searchParams = useSearchParams();

  // When Better Auth's OAuth Provider needs a login, it redirects here with
  // the ORIGINAL authorize query params (client_id, redirect_uri, state,
  // code_challenge, ...). After Google sign-in we must send the user back to
  // the authorize endpoint with those exact params so the flow can resume and
  // issue the code to the MCP client. Plain visits fall back to redirect_to/"/".
  const requestedRedirect = searchParams.get("redirect_to");
  const safeLocalRedirect =
    requestedRedirect?.startsWith("/") && !requestedRedirect.startsWith("//")
      ? requestedRedirect
      : "/";
  const callbackURL = searchParams.get("client_id")
    ? `/api/auth/oauth2/authorize?${searchParams.toString()}`
    : safeLocalRedirect;

  return (
    <main className="site-shell public-page">
      <div className="public-frame public-frame-narrow">
        <BrandLockup label="Private / Access" />
        <section className="sign-in-panel reveal-stage reveal-stage-one">
          <div className="index-line">
            <span>OAuth / Allowlisted</span>
            <span>Access 001</span>
          </div>
          <div className="sign-in-copy">
            <p className="eyebrow">Private access</p>
            <h1 className="sign-in-title">Sign in to continue.</h1>
            <p className="sign-in-description">
              Continue with the Google account approved for this private MCP.
            </p>
            <GoogleSignInButton
              callbackURL={callbackURL}
              initialError={Boolean(searchParams.get("error"))}
              label="Continue with Google"
            />
            <p className="allowlist-note">
              Access is limited to allowlisted Google accounts.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function SignInFallback() {
  return (
    <main className="site-shell public-page">
      <div className="public-frame public-frame-narrow">
        <BrandLockup label="Private / Access" />
        <section className="sign-in-panel sign-in-panel-loading">
          <BrandLoader label="Preparing private access" />
        </section>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignInForm />
    </Suspense>
  );
}
