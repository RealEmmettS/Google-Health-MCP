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
] as const;

export const MCP_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
export const MCP_PKCE_METHODS = ["S256"] as const;
export const MCP_ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;
export const MCP_REFRESH_TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 60;
