import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Tool registration seam for the MCP endpoint. Phase 5 grows this into the
 * full surface (9 read tools + resources) — handlers stay THIN and call
 * service functions in src/health-services/ (see .tasks/tasks/api.md).
 *
 * `ping` is the zod-4 compatibility spike AND a permanent connectivity
 * diagnostic: it proves auth + transport + schema conversion end-to-end
 * without touching Google.
 */

export interface ToolContext {
  /** better-auth user id from the verified MCP access token. */
  userId: string;
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Connectivity diagnostic: confirms the MCP connection, auth, and server identity. Takes an optional echo string.",
      inputSchema: {
        echo: z.string().max(200).optional().describe("Optional string to echo back"),
      },
    },
    async ({ echo }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            pong: true,
            server: "shaughv-health-mcp",
            authenticatedUserId: ctx.userId,
            echo: echo ?? null,
            time: new Date().toISOString(),
          }),
        },
      ],
    }),
  );
}
