import { decodeJwt, type JWTPayload } from "jose";

/**
 * Compatibility boundary for better-auth 1.6.x's deprecated built-in MCP
 * plugin. Its authorization-code path emits a one-request HS256 ID token while
 * discovery advertises RS256, and it advertises JWKS/UserInfo endpoints that
 * it does not implement. Keep the existing opaque OAuth credentials and DCR
 * registrations, but replace only that malformed OIDC response at the HTTP
 * boundary with a token signed by Better Auth's persisted RS256 JWT key.
 */

export const MCP_ID_TOKEN_ALGORITHM = "RS256";
export const MCP_TOKEN_REQUEST_MAX_BYTES = 16 * 1024;

const mcpAuthPaths = {
  authorize: "/api/auth/mcp/authorize",
  token: "/api/auth/mcp/token",
  register: "/api/auth/mcp/register",
  authorizationMetadata: "/api/auth/.well-known/oauth-authorization-server",
  protectedResourceMetadata: "/api/auth/.well-known/oauth-protected-resource",
} as const;

export type McpAuthPath = keyof typeof mcpAuthPaths;

export function isMcpAuthPath(pathname: string, endpoint: McpAuthPath): boolean {
  return pathname === mcpAuthPaths[endpoint];
}

export function mcpIssuer(): string {
  const configured =
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return new URL(configured).origin;
}

export function mcpResource(): string {
  return `${mcpIssuer()}/api/mcp`;
}

function numericDate(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.floor(number);
}

function normalizeAuthTime(value: unknown): number | undefined {
  const time = numericDate(value);
  if (time === undefined) return undefined;
  // The legacy plugin writes Date#getTime() here (milliseconds), while OIDC
  // NumericDate values are seconds.
  return time > 10_000_000_000 ? Math.floor(time / 1000) : time;
}

export type McpIdTokenSigner = (payload: JWTPayload) => Promise<string>;
const signerReadiness = new WeakMap<McpIdTokenSigner, Promise<void>>();

function requestMediaType(request: Request): string {
  return (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
}

export function validateMcpTokenMediaType(request: Request): Response | null {
  const mediaType = requestMediaType(request);
  if (
    mediaType === "application/x-www-form-urlencoded" ||
    mediaType === "application/json"
  ) {
    return null;
  }
  return Response.json(
    {
      error: "invalid_request",
      error_description: "The OAuth token request content type is not supported",
    },
    {
      status: 415,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

async function tokenRequestBody(request: Request): Promise<Record<string, unknown> | null> {
  const mediaType = requestMediaType(request);
  if (mediaType === "application/x-www-form-urlencoded") {
    return Object.fromEntries(new URLSearchParams(await request.text()));
  }
  if (mediaType === "application/json") {
    const parsed = await request.json().catch(() => null);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  }
  return null;
}

export async function preflightMcpTokenSigning(
  request: Request,
  sign: McpIdTokenSigner,
): Promise<Response | null> {
  const body = await tokenRequestBody(request);
  if (body?.grant_type !== "authorization_code") return null;

  const now = Math.floor(Date.now() / 1000);
  try {
    // The legacy handler consumes the authorization code and persists opaque
    // credentials before it creates its malformed ID token. Prove the durable
    // replacement key can sign before allowing that irreversible work.
    let readiness = signerReadiness.get(sign);
    if (!readiness) {
      readiness = sign({
        iss: mcpIssuer(),
        aud: "mcp-id-token-signing-preflight",
        sub: "mcp-id-token-signing-preflight",
        iat: now,
        exp: now + 60,
      }).then(() => undefined);
      signerReadiness.set(sign, readiness);
    }
    await readiness;
    return null;
  } catch {
    signerReadiness.delete(sign);
    return Response.json(
      {
        error: "server_error",
        error_description: "ID-token signing is temporarily unavailable",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      },
    );
  }
}

function oversizedTokenRequestResponse(): Response {
  return Response.json(
    {
      error: "invalid_request",
      error_description: "The OAuth token request body is too large",
    },
    {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

export async function boundMcpTokenRequest(
  request: Request,
): Promise<{ request: Request } | { response: Response }> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MCP_TOKEN_REQUEST_MAX_BYTES) {
    return { response: oversizedTokenRequestResponse() };
  }
  if (!request.body) return { request };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MCP_TOKEN_REQUEST_MAX_BYTES) {
      await reader.cancel();
      return { response: oversizedTokenRequestResponse() };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    request: new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
      redirect: request.redirect,
      signal: request.signal,
    }),
  };
}

export async function repairLegacyMcpIdToken(
  legacyIdToken: string,
  sign: McpIdTokenSigner,
  expectedClientId?: string,
): Promise<string> {
  const claims = decodeJwt(legacyIdToken);
  const audience = typeof claims.aud === "string" ? claims.aud : undefined;
  if (!claims.sub || !audience) {
    throw new Error("Legacy MCP ID token is missing subject or audience");
  }
  if (expectedClientId && audience !== expectedClientId) {
    throw new Error("Legacy MCP ID-token audience does not match the token request");
  }

  const now = Math.floor(Date.now() / 1000);
  const issuedAt = numericDate(claims.iat) ?? now;
  const expiresAt = numericDate(claims.exp) ?? issuedAt + 60 * 60;
  if (expiresAt <= issuedAt || expiresAt <= now) {
    throw new Error("Legacy MCP ID token has an invalid expiration");
  }

  const {
    iss: _legacyIssuer,
    aud: _legacyAudience,
    sub: _legacySubject,
    iat: _legacyIssuedAt,
    exp: _legacyExpiresAt,
    nbf: _legacyNotBefore,
    jti: _legacyJwtId,
    auth_time: legacyAuthTime,
    acr: _legacyAcr,
    profile: legacyProfile,
    ...legacyClaims
  } = claims;
  const authTime = normalizeAuthTime(legacyAuthTime);
  const picture =
    typeof legacyClaims.picture === "string"
      ? legacyClaims.picture
      : typeof legacyProfile === "string"
        ? legacyProfile
        : undefined;

  // Do not copy arbitrary fields from an unsigned legacy payload. These are
  // the only OIDC claims the configured built-in plugin can legitimately
  // derive from this app's user record and authorization request.
  const allowedClaims: JWTPayload = {
    ...(typeof legacyClaims.nonce === "string"
      ? { nonce: legacyClaims.nonce }
      : {}),
    ...(typeof legacyClaims.name === "string" ? { name: legacyClaims.name } : {}),
    ...(typeof legacyClaims.given_name === "string"
      ? { given_name: legacyClaims.given_name }
      : {}),
    ...(typeof legacyClaims.family_name === "string"
      ? { family_name: legacyClaims.family_name }
      : {}),
    ...(typeof legacyClaims.email === "string" ? { email: legacyClaims.email } : {}),
    ...(typeof legacyClaims.email_verified === "boolean"
      ? { email_verified: legacyClaims.email_verified }
      : {}),
    ...(numericDate(legacyClaims.updated_at) === undefined
      ? {}
      : { updated_at: numericDate(legacyClaims.updated_at) }),
    ...(picture ? { picture } : {}),
  };

  return sign({
    ...allowedClaims,
    iss: mcpIssuer(),
    aud: audience,
    sub: claims.sub,
    iat: issuedAt,
    exp: expiresAt,
    ...(authTime === undefined ? {} : { auth_time: authTime }),
  });
}

function jsonResponse(body: Record<string, unknown>, source: Response): Response {
  const headers = new Headers(source.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

export function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function tokenRequestClientId(request: Request): Promise<string | undefined> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator >= 0) return decodeURIComponent(decoded.slice(0, separator));
    } catch {
      return undefined;
    }
  }

  const mediaType = requestMediaType(request);
  if (mediaType === "application/x-www-form-urlencoded") {
    return new URLSearchParams(await request.text()).get("client_id") ?? undefined;
  }
  if (mediaType === "application/json") {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    return typeof body?.client_id === "string" ? body.client_id : undefined;
  }
  return undefined;
}

export async function repairMcpTokenResponse(
  requestCopy: Request,
  response: Response,
  sign: McpIdTokenSigner,
): Promise<Response> {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }

  const body = (await response.clone().json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body.id_token !== "string") {
    // The legacy handler omits the RFC 6749 cache directives on successful
    // refresh grants. Every successful token response carries credentials,
    // even when there is no ID token to repair.
    return withNoStore(response);
  }

  try {
    const expectedClientId = await tokenRequestClientId(requestCopy);
    body.id_token = await repairLegacyMcpIdToken(body.id_token, sign, expectedClientId);
    return withNoStore(jsonResponse(body, response));
  } catch {
    return Response.json(
      {
        error: "server_error",
        error_description: "Unable to issue a verifiable ID token",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      },
    );
  }
}

function invalidResourceResponse(): Response {
  return Response.json(
    {
      error: "invalid_target",
      error_description: "The requested OAuth resource is not supported",
    },
    {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

function validateResourceValues(values: unknown[]): Response | null {
  // Preserve existing registrations/refreshes that predate RFC 8707 resource
  // indicators. Whenever a client supplies resource, only this server's one
  // canonical protected-resource identifier is accepted.
  if (values.length === 0) return null;
  return values.length === 1 && values[0] === mcpResource()
    ? null
    : invalidResourceResponse();
}

export function validateMcpAuthorizeRequest(request: Request): Response | null {
  const query = new URL(request.url).searchParams;
  const invalidResource = validateResourceValues(query.getAll("resource"));
  if (invalidResource) return invalidResource;
  if (query.has("max_age")) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "The max_age authorization parameter is not supported",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      },
    );
  }
  return null;
}

export async function validateMcpTokenResource(request: Request): Promise<Response | null> {
  const mediaType = requestMediaType(request);
  if (mediaType === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(await request.text());
    return validateResourceValues(form.getAll("resource"));
  }
  const body = await tokenRequestBody(request);
  if (!body || !("resource" in body)) return null;
  const resources = Array.isArray(body.resource) ? body.resource : [body.resource];
  return resources.length === 0
    ? invalidResourceResponse()
    : validateResourceValues(resources);
}

async function rewriteMetadata(
  response: Response,
  transform: (metadata: Record<string, unknown>) => Record<string, unknown>,
): Promise<Response> {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }
  const metadata = (await response.clone().json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return metadata ? jsonResponse(transform(metadata), response) : response;
}

export function repairAuthorizationServerMetadata(response: Response): Promise<Response> {
  return rewriteMetadata(response, (metadata) => {
    const {
      acr_values_supported: _unsupportedAcrValues,
      claims_supported: _legacyClaims,
      ...rest
    } = metadata;
    return {
      ...rest,
      issuer: mcpIssuer(),
      jwks_uri: `${mcpIssuer()}/api/auth/mcp/jwks`,
      userinfo_endpoint: `${mcpIssuer()}/api/auth/mcp/userinfo`,
      id_token_signing_alg_values_supported: [MCP_ID_TOKEN_ALGORITHM],
      claims_supported: [
        "sub",
        "iss",
        "aud",
        "exp",
        "iat",
        "auth_time",
        "nonce",
        "email",
        "email_verified",
        "name",
        "given_name",
        "family_name",
        "picture",
        "updated_at",
      ],
    };
  });
}

export function repairProtectedResourceMetadata(response: Response): Promise<Response> {
  return rewriteMetadata(response, (metadata) => {
    const {
      resource_signing_alg_values_supported: _unsupportedAlgorithm,
      jwks_uri: _authorizationServerJwks,
      ...rest
    } = metadata;
    return {
      ...rest,
      resource: mcpResource(),
      authorization_servers: [mcpIssuer()],
    };
  });
}
