import {
  createMcpHandler,
  McpServer,
  preloadSchemas,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { registerTools } from "./register-tools";

preloadSchemas();

export const mcpHttpHandler = createMcpHandler(
  ({ authInfo }) => {
    const userId = authInfo?.extra?.userId;
    if (typeof userId !== "string" || !userId) {
      throw new Error("Authenticated MCP principal is missing");
    }

    const server = new McpServer(
      { name: "shaughv-health-mcp", version: "0.2.1" },
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

export function legacySessionAuthInfo(session: {
  accessToken: string;
  accessTokenExpiresAt: Date;
  clientId: string;
  scopes: string;
  userId: string;
}): AuthInfo {
  return {
    token: session.accessToken,
    clientId: session.clientId,
    scopes: session.scopes.split(/\s+/).filter(Boolean),
    expiresAt: Math.floor(session.accessTokenExpiresAt.getTime() / 1000),
    resource: new URL(
      `${
        process.env.BETTER_AUTH_URL ??
        process.env.NEXT_PUBLIC_APP_URL ??
        "http://localhost:3000"
      }/api/mcp`,
    ),
    extra: { userId: session.userId },
  };
}
