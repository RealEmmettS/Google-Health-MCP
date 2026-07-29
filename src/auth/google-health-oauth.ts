import {
  InvalidDpopProofError,
  InvalidGrantError,
  TokenExchangeError,
} from "../google-health/errors";
import { HEALTH_SCOPE_PARAM } from "../google-health/scopes";
import {
  GOOGLE_TOKEN_URL,
  createGoogleTokenDpopProof,
  type GoogleDpopExchange,
  type GoogleHealthDpopMaterial,
} from "./google-health-dpop";

/**
 * Google OAuth mechanics for the HEALTH-SCOPES consent flow (auth layer 3).
 * Pure fetch functions — no DB access — so they are trivially testable with a
 * stubbed global fetch.
 */

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_TIMEOUT_MS = 8_000;
const GOOGLE_IDENTITY_TIMEOUT_MS = 5_000;
export function appBaseUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}

export function healthRedirectUri(): string {
  return `${appBaseUrl()}/api/auth/google-health/callback`;
}

export function buildHealthAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: healthRedirectUri(),
    response_type: "code",
    // offline + consent => Google issues a refresh token (handoff §25.2).
    access_type: "offline",
    prompt: "consent",
    scope: HEALTH_SCOPE_PARAM,
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
  /** Internal response-header metadata; never sent to Google or a client. */
  dpopNonce?: string;
}

export interface GoogleTokenDpopOptions {
  material: GoogleHealthDpopMaterial;
  onNonce?: (nonce: string) => Promise<void>;
}

const SAFE_OAUTH_ERROR_CODES = new Set([
  "invalid_client",
  "invalid_dpop_proof",
  "invalid_grant",
  "invalid_request",
  "invalid_scope",
  "unauthorized_client",
  "unsupported_grant_type",
  "use_dpop_nonce",
]);

function oauthErrorCode(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === "string" && SAFE_OAUTH_ERROR_CODES.has(body.error)
      ? body.error
      : undefined;
  } catch {
    return undefined;
  }
}

async function postTokenEndpoint(
  body: Record<string, string>,
  exchange: GoogleDpopExchange,
  dpop?: GoogleTokenDpopOptions,
): Promise<GoogleTokenResponse> {
  let nonce = dpop?.material.nonce;
  for (let attempt = 0; attempt < 2; attempt++) {
    const proof = dpop
      ? await createGoogleTokenDpopProof(dpop.material, exchange, nonce)
      : undefined;
    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(proof ? { DPoP: proof } : {}),
        },
        body: new URLSearchParams(body).toString(),
        signal: AbortSignal.timeout(GOOGLE_TOKEN_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new TokenExchangeError(
        name === "TimeoutError" || name === "AbortError"
          ? "Google token endpoint timed out."
          : "Google token endpoint request failed.",
      );
    }

    const responseNonce = response.headers.get("dpop-nonce") ?? undefined;
    const text = await response.text();
    const errorCode = oauthErrorCode(text);
    if (
      !response.ok &&
      dpop &&
      attempt === 0 &&
      errorCode === "use_dpop_nonce" &&
      responseNonce
    ) {
      nonce = responseNonce;
      await dpop.onNonce?.(responseNonce);
      continue;
    }

    if (!response.ok) {
      if (response.status === 400 && errorCode === "invalid_grant") {
        throw new InvalidGrantError();
      }
      if (errorCode === "invalid_dpop_proof") {
        throw new InvalidDpopProofError();
      }
      throw new TokenExchangeError(
        `Google token endpoint returned ${response.status}${
          errorCode ? ` (${errorCode})` : ""
        }`,
      );
    }

    let parsed: GoogleTokenResponse;
    try {
      parsed = JSON.parse(text) as GoogleTokenResponse;
    } catch {
      throw new TokenExchangeError("Google token endpoint returned malformed JSON");
    }
    if (!parsed.access_token || typeof parsed.expires_in !== "number") {
      throw new TokenExchangeError("Google token response missing access_token/expires_in");
    }
    return {
      ...parsed,
      ...(responseNonce ? { dpopNonce: responseNonce } : nonce ? { dpopNonce: nonce } : {}),
    };
  }
  throw new TokenExchangeError("Google token endpoint rejected the DPoP nonce retry");
}

export async function exchangeCodeForTokens(
  code: string,
  dpop?: GoogleTokenDpopOptions,
): Promise<GoogleTokenResponse> {
  return postTokenEndpoint(
    {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: healthRedirectUri(),
      grant_type: "authorization_code",
    },
    { kind: "authorization_code", code },
    dpop,
  );
}

export async function refreshAccessToken(
  refreshToken: string,
  dpop?: GoogleTokenDpopOptions,
): Promise<GoogleTokenResponse> {
  return postTokenEndpoint(
    {
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    },
    { kind: "refresh_token" },
    dpop,
  );
}

export interface HealthIdentity {
  healthUserId?: string;
  legacyUserId?: string;
}

/** GET /v4/users/me/identity — store both IDs at connect time (handoff §12.3). */
export async function fetchHealthIdentity(
  accessToken: string,
): Promise<HealthIdentity | null> {
  const response = await fetch("https://health.googleapis.com/v4/users/me/identity", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(GOOGLE_IDENTITY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    healthUserId?: string;
    legacyUserId?: string;
  };
  return { healthUserId: body.healthUserId, legacyUserId: body.legacyUserId };
}
