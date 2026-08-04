import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";
import {
  MCP_ACCESS_TOKEN_LIFETIME_SECONDS,
  MCP_GRANT_TYPES,
  MCP_ISSUER,
  MCP_PKCE_METHODS,
  MCP_REFRESH_TOKEN_LIFETIME_SECONDS,
  MCP_RESOURCE,
  MCP_SCOPES,
} from "../auth/mcp-constants";

export const MCP_SERVER_INFO = {
  name: "shaughv-health-mcp",
  title: "SHAUGHV Health",
  description:
    "Private Google Health connector with read insights and explicit nutrition, hydration, and measurement writes.",
  version: "1.1.0",
  websiteUrl: "https://health.emmetts.dev",
  icons: [
    {
      src: "https://health.emmetts.dev/shaughv-health-mcp-icon.png",
      mimeType: "image/png",
      sizes: ["1254x1254"],
    },
  ],
};

export const MCP_MODERN_PROTOCOL_VERSIONS = ["2026-07-28"] as const;
export const MCP_LEGACY_PROTOCOL_VERSIONS = [...SUPPORTED_PROTOCOL_VERSIONS];

interface ClientImplementation {
  name: string;
  version: string;
}

interface GoogleHealthConnectionSummary {
  connectedAt: Date;
  scopes: string[];
  status: string;
}

export interface ConnectionInfoInput {
  clientCapabilities: Record<string, unknown> | null;
  clientId: string;
  clientImplementation: ClientImplementation | null;
  expiresAt: number;
  googleHealthConnection: GoogleHealthConnectionSummary | null;
  googleHealthConnectionChecked: boolean;
  negotiatedProtocolVersion: string;
  resource: string;
  scopes: string[];
  sessionIdPresent: boolean;
  userId: string;
}

function runtimeValue(name: string): string | null {
  const value = process.env[name];
  return value?.trim() ? value : null;
}

export function buildConnectionInfo(input: ConnectionInfoInput) {
  const isModern = MCP_MODERN_PROTOCOL_VERSIONS.includes(
    input.negotiatedProtocolVersion as (typeof MCP_MODERN_PROTOCOL_VERSIONS)[number],
  );

  return {
    server: MCP_SERVER_INFO,
    connection: {
      authenticated: true,
      principal: { userId: input.userId },
      client: {
        oauthClientId: input.clientId,
        implementation: input.clientImplementation,
        declaredCapabilities: input.clientCapabilities,
      },
      grantedScopes: input.scopes,
      accessTokenExpiresAt: new Date(input.expiresAt * 1000).toISOString(),
    },
    protocol: {
      negotiatedVersion: input.negotiatedProtocolVersion,
      era: isModern ? "modern" : "legacy",
      supportedVersions: {
        modern: [...MCP_MODERN_PROTOCOL_VERSIONS],
        legacy: [...MCP_LEGACY_PROTOCOL_VERSIONS],
      },
    },
    transport: {
      type: "streamable-http",
      endpoint: MCP_RESOURCE,
      responseMode: "auto-json-or-sse",
      sessionMode: "stateless-request-scoped",
      sessionIdPresent: input.sessionIdPresent,
      sessionPersistence: false,
      deprecatedSseEndpoint: false,
    },
    authorization: {
      type: "oauth2.1",
      humanLogin: "Google Sign-In (allowlist-only)",
      authorizationServer: {
        issuer: MCP_ISSUER,
        authorizationEndpoint: `${MCP_ISSUER}/api/auth/oauth2/authorize`,
        tokenEndpoint: `${MCP_ISSUER}/api/auth/oauth2/token`,
        registrationEndpoint: `${MCP_ISSUER}/api/auth/oauth2/register`,
        jwksUri: `${MCP_ISSUER}/api/auth/jwks`,
        userInfoEndpoint: `${MCP_ISSUER}/api/auth/oauth2/userinfo`,
      },
      protectedResource: {
        canonicalResource: MCP_RESOURCE,
        requestResource: input.resource,
        metadataUrl: `${MCP_ISSUER}/.well-known/oauth-protected-resource/api/mcp`,
        exactAudienceRequired: true,
        configuredResourceCount: 1,
      },
      clientRegistration: {
        mode: "dynamic",
        publicClient: true,
        tokenEndpointAuthMethod: "none",
      },
      authorizationCode: {
        responseType: "code",
        pkceRequired: true,
        pkceMethods: [...MCP_PKCE_METHODS],
      },
      grants: [...MCP_GRANT_TYPES],
      scopes: {
        approvedInitialGrant: [...MCP_SCOPES],
        grantedToThisConnection: input.scopes,
      },
      accessToken: {
        format: "JWT",
        signingAlgorithm: "RS256",
        issuer: MCP_ISSUER,
        audience: input.resource,
        lifetimeSeconds: MCP_ACCESS_TOKEN_LIFETIME_SECONDS,
        valuePersistedByServer: false,
      },
      refreshToken: {
        enabled: input.scopes.includes("offline_access"),
        rotation: "rotating-single-use",
        lifetimeSeconds: MCP_REFRESH_TOKEN_LIFETIME_SECONDS,
        storedAs: "hash",
        omittedResourceCompatibility: "single-configured-resource-only",
      },
      enforcement: {
        privateAllowlist: true,
        allowlistRecheckedOnEveryBearerRequest: true,
        clientSecretsStoredAs: "hash",
      },
    },
    upstreamGoogleHealth: {
      separateOAuthGrant: true,
      status: input.googleHealthConnectionChecked
        ? (input.googleHealthConnection?.status ?? "not_connected")
        : "not_checked",
      connectedAt: input.googleHealthConnection?.connectedAt.toISOString() ?? null,
      grantedScopes: input.googleHealthConnection?.scopes ?? [],
      proofOfPossession: "DPoP P-256",
      credentialEncryption: "AES-256-GCM",
      tokenExposure: "never",
    },
    runtime: {
      platform: process.env.VERCEL ? "vercel-node-function" : "local-node",
      nodeVersion: process.version,
      environment: runtimeValue("VERCEL_ENV"),
      region: runtimeValue("VERCEL_REGION"),
      gitCommitSha: runtimeValue("VERCEL_GIT_COMMIT_SHA"),
    },
    privacy: {
      credentialValuesReturned: false,
      omitted: [
        "access_token",
        "refresh_token",
        "authorization_header",
        "client_secret",
        "authorization_code",
        "redirect_payload",
        "email",
      ],
    },
  };
}
