import {
  MCP_ISSUER,
  MissingMcpScopeError,
  verifyMcpAccessToken,
  type VerifiedMcpPrincipal,
} from "./auth";

const WRITE_TOOLS = new Set([
  "acknowledge_health_updates",
  "create_nutrition_log",
  "update_nutrition_log",
  "delete_nutrition_log",
  "create_hydration_log",
  "update_measurement",
]);

const resourceMetadata = `${MCP_ISSUER}/.well-known/oauth-protected-resource/api/mcp`;

function bearerResponse(
  status: 401 | 403,
  error: "invalid_token" | "insufficient_scope",
  scope?: string,
): Response {
  const parameters = [
    `resource_metadata="${resourceMetadata}"`,
    `error="${error}"`,
    ...(scope ? [`scope="${scope}"`] : []),
  ];
  return Response.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
        "WWW-Authenticate": `Bearer ${parameters.join(", ")}`,
      },
    },
  );
}

export function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header || header.includes(",")) return undefined;
  // Authentication schemes are case-insensitive (RFC 9110 section 11.1).
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(header);
  return match?.[1];
}

export async function authenticateMcpRequest(
  request: Request,
): Promise<
  | { principal: VerifiedMcpPrincipal; token: string }
  | { response: Response }
> {
  const token = extractBearerToken(request);
  if (!token) {
    return {
      response: bearerResponse(
        401,
        "invalid_token",
        "health:read health:write",
      ),
    };
  }
  try {
    return { principal: await verifyMcpAccessToken(token), token };
  } catch (error) {
    if (error instanceof MissingMcpScopeError) {
      return {
        response: bearerResponse(403, "insufficient_scope", error.scope),
      };
    }
    return {
      response: bearerResponse(
        401,
        "invalid_token",
        "health:read health:write",
      ),
    };
  }
}

function isWriteMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (body.method !== "tools/call") return false;
  if (!body.params || typeof body.params !== "object" || Array.isArray(body.params)) {
    return false;
  }
  return WRITE_TOOLS.has((body.params as Record<string, unknown>).name as string);
}

export function requestNeedsWriteScope(parsedBody: unknown): boolean {
  return Array.isArray(parsedBody)
    ? parsedBody.some(isWriteMessage)
    : isWriteMessage(parsedBody);
}

export function insufficientWriteScopeResponse(): Response {
  return bearerResponse(403, "insufficient_scope", "health:write");
}
