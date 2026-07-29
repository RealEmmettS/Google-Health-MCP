import {
  createMcpHandler,
  McpServer,
  preloadSchemas,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import type { VerifiedMcpPrincipal } from "../auth/auth";
import { registerTools } from "./register-tools";

preloadSchemas();

export const mcpHttpHandler = createMcpHandler(
  ({ authInfo }) => {
    const userId = authInfo?.extra?.userId;
    if (typeof userId !== "string" || !userId) {
      throw new Error("Authenticated MCP principal is missing");
    }

    const server = new McpServer(
      { name: "shaughv-health-mcp", version: "0.3.0" },
      {
        cacheHints: {
          "tools/list": { ttlMs: 60 * 60 * 1000, cacheScope: "private" },
          "resources/list": { ttlMs: 60 * 60 * 1000, cacheScope: "private" },
          "resources/templates/list": {
            ttlMs: 60 * 60 * 1000,
            cacheScope: "private",
          },
          "server/discover": { ttlMs: 60 * 60 * 1000, cacheScope: "private" },
        },
      },
    );
    registerTools(server, { userId });
    return server;
  },
  {
    legacy: "stateless",
    responseMode: "auto",
    onerror: () => {
      // The route records status-only telemetry. Error objects may contain
      // request-derived data, so they are intentionally not logged here.
    },
  },
);

export function jwtPrincipalAuthInfo(
  token: string,
  principal: VerifiedMcpPrincipal,
): AuthInfo {
  return {
    token,
    clientId: principal.clientId,
    scopes: principal.scopes,
    expiresAt: principal.expiresAt,
    resource: new URL(principal.payload.aud as string),
    extra: { userId: principal.userId, email: principal.email },
  };
}
