import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { jwt, mcp } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { isAllowedEmail } from "./allowlist";

/**
 * Auth layer 4 of docs/PLAN.md: this app is an OAuth 2.1 authorization server
 * for MCP clients (claude.ai, ChatGPT, Claude Code) via the better-auth `mcp`
 * plugin (built-in in better-auth 1.6.x; migrate to @better-auth/mcp when 1.7
 * ships). The ONLY human login is Google Sign-In, and it is hard-locked to
 * ALLOWED_GOOGLE_EMAILS at BOTH user-creation and session-creation. The exact
 * approved identities and change-control rule live in ADR-0001.
 *
 * Google Health data consent (auth layer 3) is a SEPARATE flow — see
 * /api/auth/google-health/* (Phase 3). Do not conflate the two.
 */

const baseURL =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

const PRIVATE_SERVER_MESSAGE =
  "This is a private server. Your Google account is not on its allowlist.";

const jwksModelName =
  process.env.VERCEL_ENV === "production"
    ? "mcpOauthJwksProduction"
    : process.env.VERCEL_ENV === "preview"
      ? "mcpOauthJwksPreview"
      : "mcpOauthJwksDevelopment";

async function assertUserIdAllowed(userId: string): Promise<void> {
  const result = await db.execute(
    sql`select "email" from "user" where "id" = ${userId} limit 1`,
  );
  const email = (result.rows?.[0] as { email?: string } | undefined)?.email;
  if (!isAllowedEmail(email)) {
    throw new APIError("FORBIDDEN", { message: PRIVATE_SERVER_MESSAGE });
  }
}

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  socialProviders: {
    google: {
      // Empty-string fallbacks keep config importable for CLI codegen; real
      // values are required at runtime (.env.development.local / Vercel env).
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  plugins: [
    // The legacy MCP plugin advertises RS256 but generates an unverifiable,
    // ephemeral HS256 ID token. Its successful token response is repaired at
    // the HTTP boundary with this persisted, encrypted RS256 key ring.
    jwt({
      disableSettingJwtHeader: true,
      jwks: {
        jwksPath: "/mcp/jwks",
        keyPairConfig: { alg: "RS256", modulusLength: 2048 },
      },
      jwt: { issuer: new URL(baseURL).origin },
      schema: { jwks: { modelName: jwksModelName } },
    }),
    mcp({
      loginPage: "/sign-in",
      // RFC 9728 resource identifier — the MCP endpoint clients connect to.
      resource: `${baseURL}/api/mcp`,
      oidcConfig: {
        // OIDCOptions requires loginPage even though mcp() sets it above.
        loginPage: "/sign-in",
        // claude.ai and ChatGPT connectors self-register (RFC 7591).
        allowDynamicClientRegistration: true,
        // Every successful refresh receives a fresh token with this expiry,
        // preserving Emmett's 60-day idle tolerance (default was 7). The
        // deprecated plugin does not revoke the prior refresh row immediately;
        // that durable token-model migration is tracked separately in #oap.
        // Access tokens stay short (1h default).
        refreshTokenExpiresIn: 60 * 60 * 24 * 60,
        // The legacy MCP plugin's runtime default does not actually enforce
        // PKCE even though its public types/docs say it does. Require S256 for
        // every authorization-code client, especially public Claude Code
        // registrations that cannot protect a client secret.
        requirePKCE: true,
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
        // Belt-and-suspenders: even a pre-existing user row can't mint a new
        // browser session unless currently allowlisted. Already-issued MCP
        // tokens require explicit revocation; see ADR-0001.
        before: async (session) => {
          await assertUserIdAllowed(session.userId);
        },
      },
    },
  },
});
