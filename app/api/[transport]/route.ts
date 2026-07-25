import { withMcpAuth } from "better-auth/plugins";
import { createMcpHandler } from "mcp-handler";
import { auth, isUserIdAllowed } from "@/src/auth/auth";
import { registerTools } from "@/src/mcp/register-tools";

/**
 * The MCP endpoint (/api/mcp, streamable HTTP). better-auth's withMcpAuth
 * verifies the OAuth access token this app's own authorization server issued
 * (401 + WWW-Authenticate → protected-resource metadata when absent/invalid)
 * and hands the token record to the handler; tools resolve the domain user
 * from session.userId.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const handler = withMcpAuth(auth, async (req, session) => {
  if (!(await isUserIdAllowed(session.userId))) {
    return Response.json(
      { error: "access_revoked", message: "This account is not allowed to use this private server." },
      { status: 403 },
    );
  }
  return createMcpHandler(
    (server) => registerTools(server, { userId: session.userId }),
    {
      serverInfo: { name: "shaughv-health-mcp", version: "0.2.0" },
    },
    {
      basePath: "/api",
      maxDuration: 60,
    },
  )(req);
});

export { handler as GET, handler as POST, handler as DELETE };
