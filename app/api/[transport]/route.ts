import {
  authenticateMcpRequest,
  insufficientWriteScopeResponse,
  requestNeedsWriteScope,
} from "@/src/auth/mcp-bearer";
import {
  prepareMcpRequest,
  recordMcpTelemetry,
  requestInstanceMarker,
  requestTelemetryFields,
  withPrivateNoStore,
} from "@/src/mcp/http-boundary";
import { jwtPrincipalAuthInfo, mcpHttpHandler } from "@/src/mcp/server";

/**
 * Stateless /api/mcp. Every request verifies an audience-bound RS256 JWT
 * locally; no MCP session identifier or per-request auth database lookup is
 * used. Write scope is rejected before tool dispatch.
 */
export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

async function handler(req: Request): Promise<Response> {
  const startedAt = performance.now();
  const instance = requestInstanceMarker();
  const prepared = await prepareMcpRequest(req);
  const telemetry =
    "response" in prepared ? {} : requestTelemetryFields(prepared.parsedBody);

  let response: Response;
  if ("response" in prepared) {
    response = prepared.response;
  } else {
    const authenticated = await authenticateMcpRequest(req);
    if ("response" in authenticated) {
      response = authenticated.response;
    } else if (
      requestNeedsWriteScope(prepared.parsedBody) &&
      !authenticated.principal.scopes.includes("health:write")
    ) {
      response = insufficientWriteScopeResponse();
    } else {
      response = await mcpHttpHandler.fetch(req, {
        authInfo: jwtPrincipalAuthInfo(
          authenticated.token,
          authenticated.principal,
        ),
        parsedBody: prepared.parsedBody,
      });
    }
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
