import { InvalidGrantError, TokenExchangeError } from "../google-health/errors";
import { HEALTH_SCOPE_PARAM } from "../google-health/scopes";
import { redactString } from "../security/redact";

/**
 * Google OAuth mechanics for the HEALTH-SCOPES consent flow (auth layer 3).
 * Pure fetch functions — no DB access — so they are trivially testable with a
 * stubbed global fetch.
 */

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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
}

async function postTokenEndpoint(
  body: Record<string, string>,
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 400 && text.includes("invalid_grant")) {
      throw new InvalidGrantError();
    }
    throw new TokenExchangeError(
      `Google token endpoint returned ${response.status}: ${redactString(text).slice(0, 300)}`,
    );
  }

  const parsed = JSON.parse(text) as GoogleTokenResponse;
  if (!parsed.access_token || typeof parsed.expires_in !== "number") {
    throw new TokenExchangeError("Google token response missing access_token/expires_in");
  }
  return parsed;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  return postTokenEndpoint({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: healthRedirectUri(),
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  return postTokenEndpoint({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  });
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
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    healthUserId?: string;
    legacyUserId?: string;
  };
  return { healthUserId: body.healthUserId, legacyUserId: body.legacyUserId };
}
