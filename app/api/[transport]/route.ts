import { withMcpAuth } from "better-auth/plugins";
import { auth, isUserIdAllowed } from "@/src/auth/auth";
import {
  prepareMcpRequest,
  recordMcpTelemetry,
  requestInstanceMarker,
  requestTelemetryFields,
  withPrivateNoStore,
} from "@/src/mcp/http-boundary";
import { legacySessionAuthInfo, mcpHttpHandler } from "@/src/mcp/server";

/**
 * The MCP endpoint (/api/mcp, streamable HTTP). better-auth's withMcpAuth
 * verifies the OAuth access token this app's own authorization server issued
 * (401 + WWW-Authenticate → protected-resource metadata when absent/invalid)
 * and hands the token record to the handler; tools resolve the domain user
 * from session.userId.
 */
export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

async function handler(req: Request): Promise<Response> {
  const startedAt = performance.now();
  const instance = requestInstanceMarker();
  const prepared = await prepareMcpRequest(req);
  const telemetry =
    "response" in prepared
      ? {}
      : requestTelemetryFields(prepared.parsedBody);

  let response: Response;
  if ("response" in prepared) {
    response = prepared.response;
  } else {
    const authenticated = withMcpAuth(auth, async (authenticatedRequest, session) => {
      if (!(await isUserIdAllowed(session.userId))) {
        return Response.json(
          {
            error: "access_revoked",
            message: "This account is not allowed to use this private server.",
          },
          { status: 403 },
        );
      }
      return mcpHttpHandler.fetch(authenticatedRequest, {
        authInfo: legacySessionAuthInfo(session),
        parsedBody: prepared.parsedBody,
      });
    });
    response = await authenticated(req);
  }

  recordMcpTelemetry({
    era: prepared.era,
    ...telemetry,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    status: response.status,
    instance,
  });
  return withPrivateNoStore(response);
}

export { handler as GET, handler as POST, handler as DELETE };
