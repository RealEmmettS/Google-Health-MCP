import {
  createMcpHandler,
  McpServer,
  preloadSchemas,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import type { VerifiedMcpPrincipal } from "../auth/auth";
import { registerTools } from "./register-tools";

preloadSchemas();

export const MCP_SERVER_INFO = {
  name: "shaughv-health-mcp",
  title: "SHAUGHV Health",
  description:
    "Private Google Health connector with read insights and explicit nutrition, hydration, and measurement writes.",
  version: "0.3.0",
  websiteUrl: "https://health.emmetts.dev",
  icons: [
    {
      src: "https://health.emmetts.dev/shaughv-health-mcp-icon.png",
      mimeType: "image/png",
      sizes: ["1254x1254"],
    },
  ],
};

export const mcpHttpHandler = createMcpHandler(
  ({ authInfo }) => {
    const userId = authInfo?.extra?.userId;
    if (typeof userId !== "string" || !userId) {
      throw new Error("Authenticated MCP principal is missing");
    }

    const server = new McpServer(
      MCP_SERVER_INFO,
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
