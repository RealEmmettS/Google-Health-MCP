import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_ISSUER, MCP_RESOURCE } from "../../src/auth/auth";
import {
  normalizeAuthorizationServerMetadata,
  normalizeOAuthTokenResponse,
  normalizeRegistrationResponse,
  prepareOAuthRegistrationRequest,
  prepareOAuthTokenRequest,
  recordOAuthTokenTelemetry,
  resolveOAuthTokenResource,
  validateAuthorizeResource,
  withOAuthNoStore,
} from "../../src/auth/oauth-provider-boundary";

function tokenRequest(params: Record<string, string | string[]>): Request {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  return new Request(`${MCP_ISSUER}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function providerJwt(aud: string | string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    aud,
    iss: MCP_ISSUER,
    sub: "user-1",
    azp: "client-1",
    email: "owner@example.test",
    scope: "openid profile email offline_access health:read health:write",
    iat: now,
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode("test-only-provider-response-key"));
}

describe("stable OAuth provider HTTP boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks provider identity and consent responses private and non-cacheable", async () => {
    const response = withOAuthNoStore(
      Response.json({ sub: "user-1", email: "owner@example.test" }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(await response.json()).toMatchObject({ sub: "user-1" });
  });

  it("disables strict response-issuer validation for the Codex callback relay defect", async () => {
    const response = await normalizeAuthorizationServerMetadata(
      Response.json(
        {
          issuer: MCP_ISSUER,
          authorization_response_iss_parameter_supported: true,
        },
        { headers: { "cache-control": "public, max-age=300" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual({
      issuer: MCP_ISSUER,
      authorization_response_iss_parameter_supported: false,
    });
  });

  it("accepts only the one canonical authorization resource", async () => {
    expect(
      validateAuthorizeResource(
        new Request(`${MCP_ISSUER}/api/auth/oauth2/authorize?resource=${encodeURIComponent(MCP_RESOURCE)}`),
      ),
    ).toBeUndefined();
    const wrong = validateAuthorizeResource(
      new Request(`${MCP_ISSUER}/api/auth/oauth2/authorize?resource=https://other.test/api`),
    );
    expect(wrong?.status).toBe(400);
    expect(await wrong?.json()).toMatchObject({ error: "invalid_target" });

    const missing = validateAuthorizeResource(
      new Request(`${MCP_ISSUER}/api/auth/oauth2/authorize`),
    );
    expect(missing?.status).toBe(400);

    for (const query of [
      "resource=",
      `resource=${encodeURIComponent(MCP_RESOURCE)}&resource=${encodeURIComponent(MCP_RESOURCE)}`,
    ]) {
      const invalid = validateAuthorizeResource(
        new Request(`${MCP_ISSUER}/api/auth/oauth2/authorize?${query}`),
      );
      expect(invalid?.status).toBe(400);
    }
  });

  it("defaults only a missing refresh resource and forwards the canonical resource", async () => {
    const prepared = await prepareOAuthTokenRequest(
      tokenRequest({
        grant_type: "refresh_token",
        refresh_token: "never-log-this-refresh-token",
        client_id: "codex-public-client",
      }),
    );
    expect("request" in prepared).toBe(true);
    if (!("request" in prepared)) return;

    const forwarded = new URLSearchParams(await prepared.request.text());
    expect(forwarded.getAll("resource")).toEqual([MCP_RESOURCE]);
    expect(forwarded.get("refresh_token")).toBe("never-log-this-refresh-token");
    expect(prepared.telemetry).toMatchObject({
      grantType: "refresh_token",
      resourceDisposition: "defaulted",
    });
    expect(prepared.telemetry.clientIdHash).toMatch(/^[a-f0-9]{12}$/);
    expect(prepared.telemetry.clientIdHash).not.toContain("codex-public-client");
  });

  it("keeps explicit refresh resources exact and rejects wrong, blank, or duplicate values", async () => {
    const valid = await prepareOAuthTokenRequest(
      tokenRequest({ grant_type: "refresh_token", resource: MCP_RESOURCE }),
    );
    expect("request" in valid).toBe(true);
    if ("request" in valid) {
      expect(new URLSearchParams(await valid.request.text()).getAll("resource")).toEqual([
        MCP_RESOURCE,
      ]);
      expect(valid.telemetry.resourceDisposition).toBe("exact");
    }

    for (const resource of [
      "https://other.test/api",
      "",
      [MCP_RESOURCE, MCP_RESOURCE],
    ]) {
      const prepared = await prepareOAuthTokenRequest(
        tokenRequest({ grant_type: "refresh_token", resource }),
      );
      expect("response" in prepared && prepared.response.status).toBe(400);
      expect(prepared.telemetry.resourceDisposition).toBe("invalid");
      if ("response" in prepared) {
        expect(await prepared.response.json()).toMatchObject({ error: "invalid_target" });
      }
    }
  });

  it("keeps authorization-code exchange strict and disables defaulting for multiple configured resources", async () => {
    const missing = await prepareOAuthTokenRequest(
      tokenRequest({ grant_type: "authorization_code", code: "never-log-this-code" }),
    );
    expect("response" in missing && missing.response.status).toBe(400);
    expect(missing.telemetry.resourceDisposition).toBe("invalid");

    const exact = await prepareOAuthTokenRequest(
      tokenRequest({
        grant_type: "authorization_code",
        code: "never-log-this-code",
        resource: MCP_RESOURCE,
      }),
    );
    expect("request" in exact).toBe(true);
    expect(exact.telemetry.resourceDisposition).toBe("exact");

    for (const resource of [
      "https://other.test/api",
      "",
      [MCP_RESOURCE, MCP_RESOURCE],
    ]) {
      const prepared = await prepareOAuthTokenRequest(
        tokenRequest({
          grant_type: "authorization_code",
          code: "never-log-this-code",
          resource,
        }),
      );
      expect("response" in prepared && prepared.response.status).toBe(400);
      expect(prepared.telemetry.resourceDisposition).toBe("invalid");
    }

    expect(
      resolveOAuthTokenResource("refresh_token", [], [
        MCP_RESOURCE,
        "https://other.test/api/mcp",
      ]),
    ).toEqual({ disposition: "invalid" });
  });

  it("requires form token requests and supported grants", async () => {
    const json = await prepareOAuthTokenRequest(
      new Request(`${MCP_ISSUER}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect("response" in json && json.response.status).toBe(415);

    const unsupported = await prepareOAuthTokenRequest(
      tokenRequest({ grant_type: "client_credentials", resource: MCP_RESOURCE }),
    );
    expect("response" in unsupported && unsupported.response.status).toBe(400);
  });

  it("emits only privacy-safe token telemetry fields", async () => {
    const logger = vi.fn();
    await recordOAuthTokenTelemetry(
      {
        clientIdHash: "0123456789ab",
        grantType: "refresh_token",
        resourceDisposition: "defaulted",
      },
      Response.json(
        {
          error: "invalid_grant",
          error_description:
            "refresh_token=secret-token code=secret-code owner@example.test Authorization: Bearer secret",
        },
        { status: 400 },
      ),
      logger,
    );

    expect(logger).toHaveBeenCalledWith("oauth_token", {
      clientIdHash: "0123456789ab",
      grantType: "refresh_token",
      resourceDisposition: "defaulted",
      status: 400,
      errorClass: "invalid_grant",
    });
    const output = JSON.stringify(logger.mock.calls);
    for (const sensitive of [
      "secret-token",
      "secret-code",
      "owner@example.test",
      "Authorization",
      "Bearer secret",
      "error_description",
    ]) {
      expect(output).not.toContain(sensitive);
    }

    const untrustedLogger = vi.fn();
    await recordOAuthTokenTelemetry(
      {
        clientIdHash: null,
        grantType: "unknown",
        resourceDisposition: "invalid",
      },
      Response.json({ error: "secret_token_value" }, { status: 400 }),
      untrustedLogger,
    );
    expect(untrustedLogger).toHaveBeenCalledWith(
      "oauth_token",
      expect.objectContaining({ errorClass: "http_400" }),
    );
    expect(JSON.stringify(untrustedLogger.mock.calls)).not.toContain("secret_token_value");
  });

  it("rejects oversized token requests before parsing", async () => {
    const request = new Request(`${MCP_ISSUER}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(64 * 1024 + 1),
      },
      body: "grant_type=refresh_token",
    });
    const prepared = await prepareOAuthTokenRequest(request);
    expect("response" in prepared && prepared.response.status).toBe(413);
  });

  it("normalizes public native DCR to authorization-code, refresh, and no client secret", async () => {
    const prepared = await prepareOAuthRegistrationRequest(
      new Request(`${MCP_ISSUER}/api/auth/oauth2/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          application_type: "native",
          client_name: "Connector",
          redirect_uris: ["http://127.0.0.1:43123/callback"],
          resources: [MCP_RESOURCE],
          token_endpoint_auth_method: "client_secret_post",
        }),
      }),
    );
    expect("request" in prepared).toBe(true);
    if (!("request" in prepared)) return;
    expect(prepared.applicationType).toBe("native");
    const body = await prepared.request.json();
    expect(body).toMatchObject({
      type: "native",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      require_pkce: true,
    });
    expect(body).not.toHaveProperty("application_type");
    expect(body).not.toHaveProperty("resources");

    const response = await normalizeRegistrationResponse(
      Response.json({ client_id: "client-1", token_endpoint_auth_method: "none" }),
      "native",
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ application_type: "native" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects malformed DCR application types and noncanonical resources", async () => {
    for (const body of [
      { application_type: "service", redirect_uris: ["https://client.test/callback"] },
      {
        application_type: "web",
        redirect_uris: ["https://client.test/callback"],
        resource: "https://other.test/api",
      },
      {
        application_type: "native",
        redirect_uris: ["http://127.0.0.1/callback"],
        resource: 123,
      },
      {
        application_type: "native",
        redirect_uris: ["http://127.0.0.1/callback"],
        resource: MCP_RESOURCE,
        resources: [MCP_RESOURCE],
      },
      {
        application_type: "native",
        redirect_uris: ["http://127.0.0.1/callback"],
        resources: [],
      },
      {
        application_type: "native",
        redirect_uris: ["evilapp://callback"],
      },
      {
        application_type: "web",
        redirect_uris: ["http://client.test/callback"],
      },
      {
        application_type: "web",
        redirect_uris: ["https://client.test/callback#fragment"],
      },
    ]) {
      const prepared = await prepareOAuthRegistrationRequest(
        new Request(`${MCP_ISSUER}/api/auth/oauth2/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect("response" in prepared && prepared.response.status).toBe(400);
    }
  });

  it("maps public web DCR to the provider's user-agent client type", async () => {
    const prepared = await prepareOAuthRegistrationRequest(
      new Request(`${MCP_ISSUER}/api/auth/oauth2/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          application_type: "web",
          redirect_uris: ["https://client.test/callback"],
          resource: MCP_RESOURCE,
        }),
      }),
    );
    expect("request" in prepared).toBe(true);
    if ("request" in prepared) {
      expect(await prepared.request.json()).toMatchObject({
        type: "user-agent-based",
        token_endpoint_auth_method: "none",
      });
    }
  });

  it("returns standards-correct 201 for DCR that omits application_type", async () => {
    const response = await normalizeRegistrationResponse(
      Response.json({ client_id: "client-2", token_endpoint_auth_method: "none" }),
      undefined,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      client_id: "client-2",
      token_endpoint_auth_method: "none",
    });
  });

  it("accepts hosted, Hermes, Claude Code, and Codex callback profiles", async () => {
    for (const [client, redirectUri] of [
      ["Claude hosted", "https://claude.ai/api/mcp/auth_callback"],
      ["Hermes Desktop", "http://127.0.0.1:56824/callback"],
      ["Claude Code", "http://localhost:3118/callback"],
      ["Codex", "http://127.0.0.1:43123/callback/server-id"],
      ["IPv6 loopback", "http://[::1]:43123/callback"],
    ] as const) {
      const prepared = await prepareOAuthRegistrationRequest(
        new Request(`${MCP_ISSUER}/api/auth/oauth2/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ redirect_uris: [redirectUri] }),
        }),
      );
      expect("request" in prepared, `${client}: ${redirectUri}`).toBe(true);
    }
  });

  it("re-signs OpenID access tokens to the exact MCP audience", async () => {
    const userInfoAudience = `${MCP_ISSUER}/api/auth/oauth2/userinfo`;
    const sign = vi.fn(async (payload) => {
      expect(payload.aud).toBe(MCP_RESOURCE);
      expect(payload.sub).toBe("user-1");
      return "normalized.jwt.value";
    });
    const response = await normalizeOAuthTokenResponse(
      Response.json({
        access_token: await providerJwt([MCP_RESOURCE, userInfoAudience]),
        id_token: "leave.id.token",
        refresh_token: "leave-refresh-token",
      }),
      sign,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access_token: "normalized.jwt.value",
      id_token: "leave.id.token",
      refresh_token: "leave-refresh-token",
    });
    expect(sign).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not re-sign an already exact token and rejects unexpected audiences generically", async () => {
    const exact = await providerJwt(MCP_RESOURCE);
    const sign = vi.fn(async () => "unused");
    const exactResponse = await normalizeOAuthTokenResponse(
      Response.json({ access_token: exact }),
      sign,
    );
    expect((await exactResponse.json()).access_token).toBe(exact);
    expect(sign).not.toHaveBeenCalled();

    const bad = await normalizeOAuthTokenResponse(
      Response.json({ access_token: await providerJwt("https://other.test/api") }),
      sign,
    );
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({
      error: "server_error",
      error_description: "The authorization server could not issue a token.",
    });
  });
});
