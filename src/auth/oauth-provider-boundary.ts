import { createHash, timingSafeEqual } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { MCP_RESOURCE, MCP_RESOURCES } from "./auth";
import { decodeJwt, type JWTPayload } from "jose";

const MAX_OAUTH_BODY_BYTES = 64 * 1024;

function oauthError(status: number, error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
      },
    },
  );
}

function exactResource(values: string[]): Response | undefined {
  if (values.length !== 1 || values[0] !== MCP_RESOURCE) {
    return oauthError(
      400,
      "invalid_target",
      "The resource must exactly match the protected MCP endpoint.",
    );
  }
  return undefined;
}

export type OAuthGrantType =
  | "authorization_code"
  | "refresh_token"
  | "other"
  | "unknown";
export type OAuthResourceDisposition = "exact" | "defaulted" | "invalid";

export interface OAuthTokenTelemetry {
  clientIdHash: string | null;
  grantType: OAuthGrantType;
  resourceDisposition: OAuthResourceDisposition;
}

type PreparedOAuthTokenRequest =
  | { request: Request; telemetry: OAuthTokenTelemetry }
  | { response: Response; telemetry: OAuthTokenTelemetry };

type PreparedOAuthAuthorizeRequest =
  | { request: Request; telemetry: OAuthTokenTelemetry }
  | { response: Response; telemetry: OAuthTokenTelemetry };

type OAuthTokenTelemetryRecord = OAuthTokenTelemetry & {
  errorClass: string;
  status: number;
};

const SAFE_OAUTH_ERROR_CLASSES = new Set([
  "access_denied",
  "invalid_client",
  "invalid_grant",
  "invalid_request",
  "invalid_scope",
  "invalid_target",
  "server_error",
  "temporarily_unavailable",
  "unauthorized_client",
  "unsupported_grant_type",
]);

function normalizedGrantType(value: string | null): OAuthGrantType {
  if (value === "authorization_code" || value === "refresh_token") return value;
  return value === null ? "unknown" : "other";
}

function shortClientIdHash(value: string | null): string | null {
  if (!value) return null;
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function tokenTelemetry(
  params?: URLSearchParams,
  resourceDisposition: OAuthResourceDisposition = "invalid",
): OAuthTokenTelemetry {
  return {
    clientIdHash: shortClientIdHash(params?.get("client_id") ?? null),
    grantType: normalizedGrantType(params?.get("grant_type") ?? null),
    resourceDisposition,
  };
}

function authorizeTelemetry(
  params: URLSearchParams,
  resourceDisposition: OAuthResourceDisposition,
): OAuthTokenTelemetry {
  return {
    clientIdHash: shortClientIdHash(params.get("client_id")),
    grantType:
      params.get("response_type") === "code" ? "authorization_code" : "unknown",
    resourceDisposition,
  };
}

export function resolveOAuthTokenResource(
  grantType: string | null,
  values: string[],
  configuredResources: readonly string[] = MCP_RESOURCES,
):
  | { disposition: "exact" | "defaulted"; resource: string }
  | { disposition: "invalid" } {
  if (values.length === 1 && values[0] === MCP_RESOURCE) {
    return { disposition: "exact", resource: MCP_RESOURCE };
  }
  if (
    grantType === "refresh_token" &&
    values.length === 0 &&
    configuredResources.length === 1 &&
    configuredResources[0] === MCP_RESOURCE
  ) {
    return { disposition: "defaulted", resource: MCP_RESOURCE };
  }
  return { disposition: "invalid" };
}

function safeOAuthErrorClass(response: Response): Promise<string> {
  if (response.ok) return Promise.resolve("none");
  return response
    .clone()
    .json()
    .then((body: unknown) => {
      const error =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).error
          : undefined;
      return typeof error === "string" && SAFE_OAUTH_ERROR_CLASSES.has(error)
        ? error
        : `http_${response.status}`;
    })
    .catch(() => `http_${response.status}`);
}

export async function recordOAuthTokenTelemetry(
  telemetry: OAuthTokenTelemetry,
  response: Response,
  logger: (event: string, record: OAuthTokenTelemetryRecord) => void = (event, record) =>
    console.info(event, record),
): Promise<void> {
  return recordOAuthTelemetry("oauth_token", telemetry, response, logger);
}

export async function recordOAuthAuthorizeTelemetry(
  telemetry: OAuthTokenTelemetry,
  response: Response,
  logger: (event: string, record: OAuthTokenTelemetryRecord) => void = (event, record) =>
    console.info(event, record),
): Promise<void> {
  return recordOAuthTelemetry("oauth_authorize", telemetry, response, logger);
}

async function recordOAuthTelemetry(
  event: "oauth_authorize" | "oauth_token",
  telemetry: OAuthTokenTelemetry,
  response: Response,
  logger: (event: string, record: OAuthTokenTelemetryRecord) => void,
): Promise<void> {
  try {
    logger(event, {
      ...telemetry,
      status: response.status,
      errorClass: await safeOAuthErrorClass(response),
    });
  } catch {
    // Observability must never alter an OAuth response.
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array | Response> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_OAUTH_BODY_BYTES) {
      return oauthError(413, "invalid_request", "OAuth request body is too large.");
    }
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_OAUTH_BODY_BYTES) {
      await reader.cancel();
      return oauthError(413, "invalid_request", "OAuth request body is too large.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function rebuiltRequest(request: Request, body: Uint8Array, headers: Headers): Request {
  headers.delete("content-length");
  const bodyCopy = new Uint8Array(body.byteLength);
  bodyCopy.set(body);
  return new Request(request.url, {
    method: request.method,
    headers,
    body: bodyCopy.buffer,
    redirect: request.redirect,
    signal: request.signal,
  });
}

export function validateAuthorizeResource(request: Request): Response | undefined {
  const url = new URL(request.url);
  return exactResource(url.searchParams.getAll("resource"));
}

function canonicalizeOAuthQueryParams(params: URLSearchParams): string {
  const canonical = new URLSearchParams();
  const entries = [...params.entries()].sort(([keyA, valueA], [keyB, valueB]) => {
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    if (valueA < valueB) return -1;
    if (valueA > valueB) return 1;
    return 0;
  });
  for (const [key, value] of entries) canonical.append(key, value);
  return canonical.toString();
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

async function isProviderSignedAuthorizeContinuation(
  params: URLSearchParams,
  signingSecret: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!signingSecret) return false;

  const signatures = params.getAll("sig");
  const expirations = params.getAll("exp");
  const issuedAtValues = params.getAll("ba_iat");
  const signedParameterNames = params.getAll("ba_param");
  if (
    signatures.length !== 1 ||
    expirations.length !== 1 ||
    issuedAtValues.length !== 1 ||
    signedParameterNames.length === 0
  ) {
    return false;
  }

  const expirationSeconds = Number(expirations[0]);
  const issuedAt = Number(issuedAtValues[0]);
  if (
    !Number.isFinite(expirationSeconds) ||
    !Number.isFinite(issuedAt) ||
    issuedAt <= 0 ||
    issuedAt > now + 60_000 ||
    expirationSeconds * 1000 < now ||
    expirationSeconds * 1000 < issuedAt ||
    expirationSeconds * 1000 - issuedAt > 11 * 60_000
  ) {
    return false;
  }

  const signedNames = new Set(signedParameterNames);
  const actualNames = new Set(
    [...params.keys()].filter((name) => name !== "sig"),
  );
  if (
    signedNames.size !== actualNames.size ||
    [...actualNames].some((name) => !signedNames.has(name))
  ) {
    return false;
  }

  const unsigned = new URLSearchParams(params);
  unsigned.delete("sig");
  try {
    const expected = await makeSignature(
      canonicalizeOAuthQueryParams(unsigned),
      signingSecret,
    );
    return constantTimeStringEqual(signatures[0], expected);
  } catch {
    return false;
  }
}

/**
 * Better Auth 1.6.25 validates our initial authorize request, then its Zod
 * schema omits RFC 8707 `resource` before signing the post-login continuation.
 * Restore the sole canonical resource only for that authentic, unexpired
 * provider continuation. Fresh external authorize requests remain exact-only.
 */
export async function prepareOAuthAuthorizeRequest(
  request: Request,
  configuredResources: readonly string[] = MCP_RESOURCES,
  signingSecret: string | undefined = process.env.BETTER_AUTH_SECRET,
): Promise<PreparedOAuthAuthorizeRequest> {
  const url = new URL(request.url);
  const params = url.searchParams;
  const resources = params.getAll("resource");

  if (resources.length === 1 && resources[0] === MCP_RESOURCE) {
    return {
      request,
      telemetry: authorizeTelemetry(params, "exact"),
    };
  }

  const canRestoreSignedContinuation =
    resources.length === 0 &&
    configuredResources.length === 1 &&
    configuredResources[0] === MCP_RESOURCE &&
    (await isProviderSignedAuthorizeContinuation(params, signingSecret));
  if (!canRestoreSignedContinuation) {
    return {
      response: oauthError(
        400,
        "invalid_target",
        "The resource must exactly match the protected MCP endpoint.",
      ),
      telemetry: authorizeTelemetry(params, "invalid"),
    };
  }

  params.set("resource", MCP_RESOURCE);
  return {
    request: new Request(url, request),
    telemetry: authorizeTelemetry(params, "defaulted"),
  };
}

export async function prepareOAuthTokenRequest(
  request: Request,
): Promise<PreparedOAuthTokenRequest> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "application/x-www-form-urlencoded") {
    return {
      response: oauthError(
        415,
        "invalid_request",
        "The token endpoint requires a form-encoded request.",
      ),
      telemetry: tokenTelemetry(),
    };
  }

  const body = await readBoundedBody(request);
  if (body instanceof Response) {
    return { response: body, telemetry: tokenTelemetry() };
  }
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return {
      response: oauthError(400, "invalid_request", "Malformed token request."),
      telemetry: tokenTelemetry(),
    };
  }

  const grantType = params.get("grant_type");
  const resource = resolveOAuthTokenResource(grantType, params.getAll("resource"));
  if (resource.disposition === "invalid") {
    return {
      response: oauthError(
        400,
        "invalid_target",
        "The resource must exactly match the protected MCP endpoint.",
      ),
      telemetry: tokenTelemetry(params),
    };
  }

  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return {
      response: oauthError(
        400,
        "unsupported_grant_type",
        "Only authorization_code and refresh_token grants are supported.",
      ),
      telemetry: tokenTelemetry(params, resource.disposition),
    };
  }

  let forwardedBody = body;
  if (resource.disposition === "defaulted") {
    params.append("resource", resource.resource);
    forwardedBody = new TextEncoder().encode(params.toString());
  }

  return {
    request: rebuiltRequest(request, forwardedBody, new Headers(request.headers)),
    telemetry: tokenTelemetry(params, resource.disposition),
  };
}

type JsonObject = Record<string, unknown>;

const USERINFO_AUDIENCE = `${new URL(MCP_RESOURCE).origin}/api/auth/oauth2/userinfo`;

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}

function isSafeConnectorRedirect(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    return url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopbackHostname(url.hostname));
  } catch {
    return false;
  }
}

function validRedirectList(value: unknown, required: boolean): value is string[] {
  if (value === undefined) return !required;
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isSafeConnectorRedirect)
  );
}

function tokenServerError(): Response {
  return oauthError(500, "server_error", "The authorization server could not issue a token.");
}

function validProviderAccessPayload(payload: JWTPayload): boolean {
  const audience = payload.aud;
  const audienceIsExpected =
    audience === MCP_RESOURCE ||
    (Array.isArray(audience) &&
      audience.length === 2 &&
      new Set(audience).size === 2 &&
      audience.includes(MCP_RESOURCE) &&
      audience.includes(USERINFO_AUDIENCE));
  return (
    audienceIsExpected &&
    payload.iss === new URL(MCP_RESOURCE).origin &&
    typeof payload.sub === "string" &&
    payload.sub.length > 0 &&
    typeof payload.azp === "string" &&
    payload.azp.length > 0 &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number" &&
    payload.exp > payload.iat &&
    typeof payload.scope === "string" &&
    typeof payload.email === "string"
  );
}

/**
 * Better Auth 1.6.25 adds its UserInfo URL to an OpenID access token's `aud`
 * array. GHSA-p2fr-6hmx-4528's stable-line workaround requires this resource
 * server to accept exactly one audience. This in-process boundary validates
 * the provider-generated token and re-signs it with only the canonical MCP
 * audience; the ID token is left untouched and UserInfo still accepts the MCP
 * audience through the provider's configured `validAudiences`.
 */
export async function normalizeOAuthTokenResponse(
  response: Response,
  signAccessToken: (payload: JWTPayload) => Promise<string>,
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  try {
    const body = (await response.json()) as JsonObject;
    if (typeof body.access_token !== "string") return tokenServerError();
    const payload = decodeJwt(body.access_token);
    if (!validProviderAccessPayload(payload)) return tokenServerError();
    if (payload.aud !== MCP_RESOURCE) {
      body.access_token = await signAccessToken({
        ...payload,
        aud: MCP_RESOURCE,
      });
    }
    return Response.json(body, { status: response.status, headers });
  } catch {
    // Do not include the provider response, token, code, or signing error.
    return tokenServerError();
  }
}

function registrationResources(body: JsonObject): string[] | undefined {
  const hasResource = Object.hasOwn(body, "resource");
  const hasResources = Object.hasOwn(body, "resources");
  if (hasResource && hasResources) return undefined;
  if (hasResource) {
    return typeof body.resource === "string" ? [body.resource] : undefined;
  }
  if (hasResources) {
    return Array.isArray(body.resources) &&
      body.resources.length > 0 &&
      body.resources.every((value) => typeof value === "string")
      ? (body.resources as string[])
      : undefined;
  }
  return [];
}

export async function prepareOAuthRegistrationRequest(
  request: Request,
): Promise<
  | { request: Request; applicationType: "native" | "web" | undefined }
  | { response: Response }
> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    return {
      response: oauthError(
        415,
        "invalid_client_metadata",
        "Dynamic registration requires application/json.",
      ),
    };
  }

  const raw = await readBoundedBody(request);
  if (raw instanceof Response) return { response: raw };
  let body: JsonObject;
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as JsonObject;
  } catch {
    return {
      response: oauthError(400, "invalid_client_metadata", "Malformed registration request."),
    };
  }

  const resources = registrationResources(body);
  if (!resources) {
    return {
      response: oauthError(
        400,
        "invalid_client_metadata",
        "Use one well-formed resource indicator field.",
      ),
    };
  }
  if (resources.length) {
    const invalidResource = exactResource(resources);
    if (invalidResource) return { response: invalidResource };
  }

  const requestedApplicationType = body.application_type;
  if (
    requestedApplicationType !== undefined &&
    requestedApplicationType !== "native" &&
    requestedApplicationType !== "web"
  ) {
    return {
      response: oauthError(
        400,
        "invalid_client_metadata",
        "application_type must be native or web.",
      ),
    };
  }
  const applicationType = requestedApplicationType as "native" | "web" | undefined;

  if (
    !validRedirectList(body.redirect_uris, true) ||
    !validRedirectList(body.post_logout_redirect_uris, false)
  ) {
    return {
      response: oauthError(
        400,
        "invalid_redirect_uri",
        "Redirect URIs must use HTTPS or an HTTP localhost/loopback address.",
      ),
    };
  }

  // Connector DCR is deliberately public. The provider independently forces
  // unauthenticated registrations to `none`; normalizing here also ensures
  // the response and stored record cannot drift from the S256-only posture.
  body.token_endpoint_auth_method = "none";
  body.grant_types = ["authorization_code", "refresh_token"];
  body.response_types = ["code"];
  body.require_pkce = true;
  if (applicationType === "native") body.type = "native";
  else if (applicationType === "web") body.type = "user-agent-based";
  else delete body.type;
  delete body.application_type;
  delete body.resource;
  delete body.resources;

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  return {
    request: rebuiltRequest(request, encoded, headers),
    applicationType,
  };
}

export async function normalizeRegistrationResponse(
  response: Response,
  applicationType: "native" | "web" | undefined,
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  try {
    const body = (await response.json()) as JsonObject;
    if (applicationType) body.application_type = applicationType;
    return Response.json(body, { status: 201, headers });
  } catch {
    return oauthError(
      500,
      "server_error",
      "The authorization server could not register the client.",
    );
  }
}

/**
 * Codex 0.146.0 receives the RFC 9207 `iss` authorization-response parameter,
 * but drops it before asking rmcp to validate the callback. Advertising RFC
 * 9207 support therefore makes an otherwise valid callback fail locally. Keep
 * emitting `iss` through Better Auth, while temporarily telling clients not to
 * require it until Codex preserves the parameter end to end.
 *
 * Tracking: https://github.com/openai/codex/issues/34684
 */
export async function normalizeAuthorizationServerMetadata(
  response: Response,
): Promise<Response> {
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  const body = (await response.json()) as JsonObject;
  body.authorization_response_iss_parameter_supported = false;
  return Response.json(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withOAuthNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
