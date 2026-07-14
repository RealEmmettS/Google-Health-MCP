import { generateKeyPair, jwtVerify, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boundMcpTokenRequest,
  isMcpAuthPath,
  MCP_TOKEN_REQUEST_MAX_BYTES,
  mcpResource,
  preflightMcpTokenSigning,
  repairAuthorizationServerMetadata,
  repairLegacyMcpIdToken,
  repairMcpTokenResponse,
  repairProtectedResourceMetadata,
  validateMcpAuthorizeRequest,
  validateMcpTokenResource,
  validateMcpTokenMediaType,
} from "../../src/auth/mcp-oauth-compat";

describe("legacy MCP OAuth compatibility boundary", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "https://health.example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ignored.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("replaces the malformed legacy ID token with verifiable RS256 OIDC claims", async () => {
    const now = Math.floor(Date.now() / 1000);
    const legacy = await new SignJWT({
      sub: "user-1",
      aud: "client-1",
      auth_time: (now - 30) * 1000,
      nonce: "nonce-1",
      name: "Example User",
      profile: "https://images.example.test/avatar.png",
      acr: "urn:mace:incommon:iap:silver",
      untrusted_extension: "must-not-survive",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(new TextEncoder().encode("legacy-ephemeral-signing-key"));

    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      modulusLength: 2048,
    });
    const repaired = await repairLegacyMcpIdToken(
      legacy,
      (payload) =>
        new SignJWT(payload)
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .sign(privateKey),
      "client-1",
    );
    const verified = await jwtVerify(repaired, publicKey, {
      algorithms: ["RS256"],
      issuer: "https://health.example.test",
      audience: "client-1",
      subject: "user-1",
    });

    expect(verified.protectedHeader).toMatchObject({ alg: "RS256", kid: "test-key" });
    expect(verified.payload).toMatchObject({
      auth_time: now - 30,
      nonce: "nonce-1",
      name: "Example User",
      picture: "https://images.example.test/avatar.png",
    });
    expect(verified.payload).not.toHaveProperty("acr");
    expect(verified.payload).not.toHaveProperty("profile");
    expect(verified.payload).not.toHaveProperty("untrusted_extension");
  });

  it("rejects an ID-token audience that differs from the token-request client", async () => {
    const now = Math.floor(Date.now() / 1000);
    const legacy = await new SignJWT({ sub: "user-1", aud: "different-client" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(new TextEncoder().encode("legacy-ephemeral-signing-key"));

    await expect(
      repairLegacyMcpIdToken(legacy, async () => "unused", "client-1"),
    ).rejects.toThrow("audience");
  });

  it("preserves OAuth no-store semantics when rewriting a token response", async () => {
    const now = Math.floor(Date.now() / 1000);
    const legacy = await new SignJWT({ sub: "user-1", aud: "client-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(new TextEncoder().encode("legacy-ephemeral-signing-key"));
    const request = new Request("https://health.example.test/api/auth/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: "client-1" }),
    });

    const repaired = await repairMcpTokenResponse(
      request,
      Response.json({ access_token: "opaque", id_token: legacy }),
      async () => "replacement-id-token",
    );

    expect(repaired.headers.get("cache-control")).toBe("no-store");
    expect(repaired.headers.get("pragma")).toBe("no-cache");
    await expect(repaired.json()).resolves.toMatchObject({
      access_token: "opaque",
      id_token: "replacement-id-token",
    });
  });

  it("does not invent auth_time when the legacy token did not contain it", async () => {
    const now = Math.floor(Date.now() / 1000);
    const legacy = await new SignJWT({ sub: "user-1", aud: "client-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(new TextEncoder().encode("legacy-ephemeral-signing-key"));
    let signedPayload: Record<string, unknown> | undefined;

    await repairLegacyMcpIdToken(legacy, async (payload) => {
      signedPayload = payload;
      return "replacement";
    });

    expect(signedPayload).not.toHaveProperty("auth_time");
  });

  it("accepts only the canonical supplied resource while preserving legacy omission", async () => {
    expect(mcpResource()).toBe("https://health.example.test/api/mcp");
    expect(
      validateMcpAuthorizeRequest(
        new Request("https://health.example.test/api/auth/mcp/authorize"),
      ),
    ).toBeNull();
    expect(
      validateMcpAuthorizeRequest(
        new Request(
          "https://health.example.test/api/auth/mcp/authorize?resource=https%3A%2F%2Fhealth.example.test%2Fapi%2Fmcp",
        ),
      ),
    ).toBeNull();

    const wrongAuthorize = validateMcpAuthorizeRequest(
      new Request(
        "https://health.example.test/api/auth/mcp/authorize?resource=https%3A%2F%2Fevil.example%2Fapi%2Fmcp",
      ),
    );
    expect(wrongAuthorize?.status).toBe(400);
    expect(
      validateMcpAuthorizeRequest(
        new Request("https://health.example.test/api/auth/mcp/authorize?max_age=0"),
      )?.status,
    ).toBe(400);

    const correctToken = await validateMcpTokenResource(
      new Request("https://health.example.test/api/auth/mcp/token", {
        method: "POST",
        headers: { "Content-Type": "Application/X-WWW-Form-Urlencoded; Charset=UTF-8" },
        body: new URLSearchParams({ resource: mcpResource() }),
      }),
    );
    expect(correctToken).toBeNull();

    const duplicateToken = await validateMcpTokenResource(
      new Request("https://health.example.test/api/auth/mcp/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `resource=${encodeURIComponent(mcpResource())}&resource=${encodeURIComponent(
          mcpResource(),
        )}`,
      }),
    );
    expect(duplicateToken?.status).toBe(400);

    const emptyJsonResource = await validateMcpTokenResource(
      new Request("https://health.example.test/api/auth/mcp/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: [] }),
      }),
    );
    expect(emptyJsonResource?.status).toBe(400);
  });

  it("proves signing availability before an authorization code can be consumed", async () => {
    const authorizationCodeRequest = new Request(
      "https://health.example.test/api/auth/mcp/token",
      {
        method: "POST",
        headers: { "Content-Type": "Application/X-WWW-Form-Urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: "code-1" }),
      },
    );
    const sign = vi.fn(async () => "signed-preflight");
    await expect(
      preflightMcpTokenSigning(authorizationCodeRequest, sign),
    ).resolves.toBeNull();
    expect(sign).toHaveBeenCalledOnce();

    const concurrentSign = vi.fn(async () => "signed-preflight");
    const concurrentRequests = ["one", "two", "three"].map(
      (code) =>
        new Request("https://health.example.test/api/auth/mcp/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code }),
        }),
    );
    await Promise.all(
      concurrentRequests.map((request) =>
        preflightMcpTokenSigning(request, concurrentSign),
      ),
    );
    expect(concurrentSign).toHaveBeenCalledOnce();

    const unavailable = await preflightMcpTokenSigning(
      new Request("https://health.example.test/api/auth/mcp/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: "code-2" }),
      }),
      async () => {
        throw new Error("database unavailable");
      },
    );
    expect(unavailable?.status).toBe(503);
    expect(unavailable?.headers.get("cache-control")).toBe("no-store");

    await expect(
      validateMcpTokenResource(
        new Request("https://health.example.test/api/auth/mcp/token", {
          method: "POST",
          headers: { "Content-Type": "Application/JSON" },
          body: "true",
        }),
      ),
    ).resolves.toBeNull();

    const oversized = await boundMcpTokenRequest(
      new Request("https://health.example.test/api/auth/mcp/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "x".repeat(MCP_TOKEN_REQUEST_MAX_BYTES + 1),
      }),
    );
    expect("response" in oversized ? oversized.response.status : 0).toBe(400);
  });

  it("matches only the exact Better Auth MCP compatibility paths", () => {
    expect(isMcpAuthPath("/api/auth/mcp/token", "token")).toBe(true);
    expect(isMcpAuthPath("/api/auth/random/mcp/token", "token")).toBe(false);
    expect(isMcpAuthPath("/mcp/token", "token")).toBe(false);

    expect(
      validateMcpTokenMediaType(
        new Request("https://health.example.test/api/auth/mcp/token", {
          method: "POST",
          headers: { "Content-Type": "Application/JSON; Charset=UTF-8" },
          body: "{}",
        }),
      ),
    ).toBeNull();
    expect(
      validateMcpTokenMediaType(
        new Request("https://health.example.test/api/auth/mcp/token", {
          method: "POST",
          headers: { "Content-Type": "application/jsonfoo" },
          body: "{}",
        }),
      )?.status,
    ).toBe(415);
    expect(
      validateMcpTokenMediaType(
        new Request("https://health.example.test/api/auth/mcp/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencodedevil" },
          body: "grant_type=authorization_code",
        }),
      )?.status,
    ).toBe(415);
  });

  it("repairs authorization metadata and removes misleading resource signing metadata", async () => {
    const authorization = await repairAuthorizationServerMetadata(
      Response.json({
        issuer: "https://wrong.example",
        jwks_uri: "https://wrong.example/jwks",
        id_token_signing_alg_values_supported: ["RS256"],
      }),
    );
    await expect(authorization.json()).resolves.toMatchObject({
      issuer: "https://health.example.test",
      jwks_uri: "https://health.example.test/api/auth/mcp/jwks",
      userinfo_endpoint: "https://health.example.test/api/auth/mcp/userinfo",
      id_token_signing_alg_values_supported: ["RS256"],
      claims_supported: expect.arrayContaining(["auth_time", "nonce", "picture"]),
    });
    const repairedAuthorization = (await repairAuthorizationServerMetadata(
      Response.json({ acr_values_supported: ["silver"], claims_supported: ["jti"] }),
    ).then((response) => response.json())) as Record<string, unknown>;
    expect(repairedAuthorization).not.toHaveProperty("acr_values_supported");
    expect(repairedAuthorization.claims_supported).not.toContain("jti");

    const protectedResource = await repairProtectedResourceMetadata(
      Response.json({
        resource: "https://wrong.example",
        authorization_servers: ["https://wrong.example"],
        jwks_uri: "https://wrong.example/jwks",
        resource_signing_alg_values_supported: ["RS256"],
      }),
    );
    const metadata = (await protectedResource.json()) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      resource: "https://health.example.test/api/mcp",
      authorization_servers: ["https://health.example.test"],
    });
    expect(metadata).not.toHaveProperty("jwks_uri");
    expect(metadata).not.toHaveProperty("resource_signing_alg_values_supported");
  });
});
