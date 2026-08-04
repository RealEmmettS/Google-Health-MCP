import {
  createMcpHandler,
  McpServer,
  preloadSchemas,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import type { VerifiedMcpPrincipal } from "../auth/auth";
import { MCP_SERVER_INFO } from "./connection-info";
import { registerTools } from "./register-tools";

preloadSchemas();

export { MCP_SERVER_INFO } from "./connection-info";

export const mcpHttpHandler = createMcpHandler(
  ({ authInfo }) => {
    const userId = authInfo?.extra?.userId;
    if (
      typeof userId !== "string" ||
      !userId ||
      typeof authInfo?.clientId !== "string" ||
      !authInfo.clientId ||
      typeof authInfo.expiresAt !== "number" ||
      !(authInfo.resource instanceof URL)
    ) {
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
    registerTools(server, {
      clientId: authInfo.clientId,
      expiresAt: authInfo.expiresAt,
      resource: authInfo.resource.toString(),
      scopes: authInfo.scopes,
      protocolVersionHint:
        typeof authInfo.extra?.protocolVersion === "string"
          ? authInfo.extra.protocolVersion
          : undefined,
      userId,
    });
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
  protocolVersion?: string,
): AuthInfo {
  return {
    token,
    clientId: principal.clientId,
    scopes: principal.scopes,
    expiresAt: principal.expiresAt,
    resource: new URL(principal.payload.aud as string),
    extra: {
      userId: principal.userId,
      email: principal.email,
      ...(protocolVersion ? { protocolVersion } : {}),
    },
  };
}
