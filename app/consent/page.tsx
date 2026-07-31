"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BrandLoader, BrandLockup } from "../components/brand-elements";

interface PublicClient {
  client_id?: string;
  client_name?: string;
  client_uri?: string;
}

function capabilityCopy(scopes: Set<string>) {
  const capabilities = [
    {
      key: "read",
      title: "Read Google Health",
      detail:
        "View health data and sync status.",
      enabled: scopes.has("health:read"),
    },
    {
      key: "write",
      title: "Make limited updates",
      detail:
        "Update nutrition, hydration, and measurements only.",
      enabled: scopes.has("health:write"),
    },
    {
      key: "offline",
      title: "Stay connected",
      detail:
        "Stay signed in with a rotating refresh token.",
      enabled: scopes.has("offline_access"),
    },
  ];
  return capabilities.filter((capability) => capability.enabled);
}

function ConsentForm() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const scopes = useMemo(
    () => new Set((searchParams.get("scope") ?? "").split(/\s+/).filter(Boolean)),
    [searchParams],
  );
  const capabilities = capabilityCopy(scopes);
  const [client, setClient] = useState<PublicClient | null>(null);
  const [pending, setPending] = useState<"accept" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!clientId) {
      setError("Missing connector identity. Return to the connector and try again.");
      return () => {
        active = false;
      };
    }
    fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = (await response.json()) as PublicClient;
        if (value.client_id !== clientId) throw new Error();
        return value;
      })
      .then((value) => {
        if (active) setClient(value);
      })
      .catch(() => {
        if (active) {
          setClient(null);
          setError("Connector verification failed. Return to the connector and try again.");
        }
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  async function decide(accept: boolean) {
    if (!client || client.client_id !== clientId) return;
    setPending(accept ? "accept" : "deny");
    setError(null);
    try {
      const oauthQuery = window.location.search.replace(/^\?/, "");
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const result = (await response.json()) as {
        redirect_uri?: string;
        url?: string;
      };
      const destination = result.url ?? result.redirect_uri;
      if (!response.ok || !destination) throw new Error();
      window.location.assign(destination);
    } catch {
      setError("Authorization failed. Return to the connector and try again.");
      setPending(null);
    }
  }

  const clientName = client?.client_name?.trim() || "Verifying connector";

  return (
    <main className="site-shell public-page consent-page">
      <div className="public-frame public-frame-narrow">
        <BrandLockup label="Private / Consent" />
        <section className="consent-panel reveal-stage reveal-stage-one">
          <div className="index-line">
            <span>OAuth grant</span>
            <span>001 / Private</span>
          </div>
          <div className="consent-copy">
            <p className="eyebrow">Connector request</p>
            <h1 className="sign-in-title">Allow health access?</h1>
            <p className="sign-in-description">
              <strong>{clientName}</strong> wants to use SHAUGHV Health MCP for you.
              No health values are shown here.
            </p>
            <p className="consent-client-id">
              Client / {client?.client_id ?? "Pending verification"}
            </p>
            <div className="consent-capabilities" aria-label="Requested capabilities">
              {capabilities.map((capability, index) => (
                <article className="consent-capability" key={capability.key}>
                  <span className="consent-scope">0{index + 1} / {capability.key}</span>
                  <h2>{capability.title}</h2>
                  <p>{capability.detail}</p>
                </article>
              ))}
            </div>
            <div className="consent-footer">
              <p className="allowlist-note">
                Allowlisted accounts only. Revocation stops refresh; active access may
                last one hour.
              </p>
              <div className="consent-actions">
                {!error ? (
                  <>
                    <button
                      className="button button-primary button-large"
                      type="button"
                      disabled={pending !== null || !client}
                      aria-busy={pending === "accept"}
                      onClick={() => decide(true)}
                    >
                      {pending === "accept" ? "Authorizing" : "Allow connector"}
                    </button>
                    <button
                      className="button button-danger button-large"
                      type="button"
                      disabled={pending !== null || !client}
                      aria-busy={pending === "deny"}
                      onClick={() => decide(false)}
                    >
                      {pending === "deny" ? "Denying" : "Deny"}
                    </button>
                  </>
                ) : null}
                {error ? <p className="inline-error" role="alert">{error}</p> : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ConsentFallback() {
  return (
    <main className="site-shell public-page consent-page">
      <div className="public-frame public-frame-narrow">
        <BrandLockup label="Private / Consent" />
        <section className="sign-in-panel sign-in-panel-loading">
          <BrandLoader label="Preparing consent" />
        </section>
      </div>
    </main>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={<ConsentFallback />}>
      <ConsentForm />
    </Suspense>
  );
}
