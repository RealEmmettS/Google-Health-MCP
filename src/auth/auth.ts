import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { jwt } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import type { JSONWebKeySet, JWTPayload } from "jose";
import { db } from "../db/client";
import { isAllowedEmail } from "./allowlist";

/**
 * Auth layer 4 of docs/PLAN.md. This app is the OAuth 2.1 authorization
 * server; Google Sign-In establishes the human identity but a Google token is
 * never accepted as an MCP bearer token. Google Health consent remains the
 * separate layer-3 flow under /api/auth/google-health/*.
 */

const configuredBaseUrl =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

export const MCP_ISSUER = new URL(configuredBaseUrl).origin;
export const MCP_RESOURCE = `${MCP_ISSUER}/api/mcp`;
// Keep the configured authorization-server resource set explicit. The token
// boundary may default an omitted refresh resource only while this contains
// the one canonical MCP endpoint.
export const MCP_RESOURCES = [MCP_RESOURCE] as const;
export const MCP_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "health:read",
  "health:write",
];

const PRIVATE_SERVER_MESSAGE =
  "This is a private server. Your Google account is not on its allowlist.";

const jwksModelName =
  process.env.VERCEL_ENV === "production"
    ? "mcpOauthJwksProduction"
    : process.env.VERCEL_ENV === "preview"
      ? "mcpOauthJwksPreview"
      : "mcpOauthJwksDevelopment";

export async function isUserIdAllowed(userId: string): Promise<boolean> {
  const result = await db.execute(
    sql`select "email" from "user" where "id" = ${userId} limit 1`,
  );
  const email = (result.rows?.[0] as { email?: string } | undefined)?.email;
  return isAllowedEmail(email);
}

async function assertUserIdAllowed(userId: string): Promise<void> {
  if (!(await isUserIdAllowed(userId))) {
    throw new APIError("FORBIDDEN", { message: PRIVATE_SERVER_MESSAGE });
  }
}

export const auth = betterAuth({
  baseURL: MCP_ISSUER,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "mcpOauthRateLimitV2",
  },
  socialProviders: {
    google: {
      // Empty fallbacks keep config importable for schema tooling. Production
      // startup still requires the real Vercel environment values.
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  plugins: [
    jwt({
      disableSettingJwtHeader: true,
      jwks: {
        jwksPath: "/jwks",
        keyPairConfig: { alg: "RS256", modulusLength: 2048 },
      },
      jwt: { issuer: MCP_ISSUER },
      schema: { jwks: { modelName: jwksModelName } },
    }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      // Both discovery routes are implemented by this app. Silence only the
      // provider's generic reminder after those routes are regression-tested.
      silenceWarnings: {
        oauthAuthServerConfig: true,
        openidConfig: true,
      },
      scopes: MCP_SCOPES,
      // SECURITY: 1.6.x does not bind RFC 8707 resources to grants. The
      // upstream GHSA-p2fr-6hmx-4528 workaround is a *single* audience plus
      // exact resource-server verification. Do not add another entry here.
      validAudiences: [...MCP_RESOURCES],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: MCP_SCOPES,
      clientRegistrationAllowedScopes: MCP_SCOPES,
      allowPublicClientPrelogin: true,
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: 60 * 60,
      refreshTokenExpiresIn: 60 * 60 * 24 * 60,
      storeTokens: "hashed",
      storeClientSecret: "hashed",
      advertisedMetadata: {
        scopes_supported: MCP_SCOPES,
        claims_supported: [
          "sub",
          "iss",
          "aud",
          "exp",
          "iat",
          "sid",
          "scope",
          "azp",
          "email",
          "email_verified",
          "name",
          "picture",
        ],
      },
      customAccessTokenClaims: async ({ user, resource }) => {
        if (resource !== MCP_RESOURCE) {
          throw new APIError("BAD_REQUEST", {
            message: "The token resource must exactly match the MCP endpoint.",
          });
        }
        if (!user?.email || !isAllowedEmail(user.email)) {
          throw new APIError("FORBIDDEN", { message: PRIVATE_SERVER_MESSAGE });
        }
        return {
          email: user.email,
          email_verified: user.emailVerified === true,
        };
      },
      customUserInfoClaims: async ({ user }) => ({
        email: user.email,
        email_verified: user.emailVerified === true,
      }),
      schema: {
        oauthClient: { modelName: "mcpOauthClientV2" },
        oauthAccessToken: { modelName: "mcpOauthAccessTokenV2" },
        oauthConsent: { modelName: "mcpOauthConsentV2" },
      },
      rateLimit: {
        // Retain the provider's stricter defaults explicitly. In particular,
        // unauthenticated DCR is capped at five registrations/IP/minute.
        token: { window: 60, max: 20 },
        authorize: { window: 60, max: 30 },
        introspect: { window: 60, max: 100 },
        revoke: { window: 60, max: 30 },
        register: { window: 60, max: 5 },
        userinfo: { window: 60, max: 60 },
      },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isAllowedEmail(user.email)) {
            throw new APIError("FORBIDDEN", { message: PRIVATE_SERVER_MESSAGE });
          }
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          await assertUserIdAllowed(session.userId);
        },
      },
    },
  },
});

const localJwksCacheKey = {};

async function readLocalJwks(): Promise<JSONWebKeySet | undefined> {
  const value = await auth.api.getJwks({ asResponse: false });
  if (!value || !Array.isArray(value.keys)) return undefined;
  return value as JSONWebKeySet;
}

export interface VerifiedMcpPrincipal {
  clientId: string;
  email: string;
  expiresAt: number;
  payload: JWTPayload;
  scopes: string[];
  userId: string;
}

export class MissingMcpScopeError extends Error {
  readonly scope: string;

  constructor(scope: string) {
    super(`Missing required MCP scope: ${scope}`);
    this.name = "MissingMcpScopeError";
    this.scope = scope;
  }
}

export function validateMcpAccessTokenPayload(
  payload: JWTPayload,
): VerifiedMcpPrincipal {
  // JOSE considers an audience array containing the expected value valid. Our
  // private resource contract is deliberately stricter: exactly one string.
  if (payload.aud !== MCP_RESOURCE) {
    throw new APIError("UNAUTHORIZED", { message: "invalid access token" });
  }
  if (
    payload.iss !== MCP_ISSUER ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.email !== "string" ||
    !isAllowedEmail(payload.email) ||
    typeof payload.exp !== "number" ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new APIError("UNAUTHORIZED", { message: "invalid access token" });
  }

  const scopes =
    typeof payload.scope === "string"
      ? payload.scope.split(/\s+/).filter(Boolean)
      : [];
  if (!scopes.includes("health:read")) {
    throw new MissingMcpScopeError("health:read");
  }

  const clientId =
    typeof payload.client_id === "string" && payload.client_id
      ? payload.client_id
      : typeof payload.azp === "string" && payload.azp
        ? payload.azp
        : undefined;
  if (!clientId) {
    throw new APIError("UNAUTHORIZED", { message: "invalid access token" });
  }

  return {
    clientId,
    email: payload.email,
    expiresAt: payload.exp,
    payload,
    scopes,
    userId: payload.sub,
  };
}

/**
 * Verifies bearer JWTs locally against Better Auth's persisted RS256 key ring.
 * The official verifier caches this function-backed JWKS for five minutes, so
 * warm MCP requests do not perform auth queries or remote introspection.
 */
export async function verifyMcpAccessToken(
  token: string,
): Promise<VerifiedMcpPrincipal> {
  const payload = await verifyJwsAccessToken(token, {
    jwksFetch: readLocalJwks,
    jwksCacheKey: localJwksCacheKey,
    verifyOptions: {
      algorithms: ["RS256"],
      issuer: MCP_ISSUER,
      audience: MCP_RESOURCE,
    },
  });

  return validateMcpAccessTokenPayload(payload);
}
