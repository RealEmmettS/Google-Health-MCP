import { beforeEach, describe, expect, it } from "vitest";
import {
  MCP_RESOURCE,
  MCP_SCOPES,
  MissingMcpScopeError,
  validateMcpAccessTokenPayload,
} from "../../src/auth/auth";
import {
  authenticateMcpRequest,
  extractBearerToken,
  insufficientWriteScopeResponse,
  requestNeedsWriteScope,
} from "../../src/auth/mcp-bearer";

function principalPayload(overrides: Record<string, unknown> = {}) {
  return {
    aud: MCP_RESOURCE,
    iss: new URL(MCP_RESOURCE).origin,
    sub: "user-1",
    azp: "client-1",
    email: "owner@example.test",
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: "openid health:read health:write",
    ...overrides,
  };
}

describe("MCP bearer boundary", () => {
  beforeEach(() => {
    process.env.ALLOWED_GOOGLE_EMAILS = "owner@example.test,owner+alias@example.test";
  });

  it("accepts one strict Bearer credential and rejects ambiguous headers", () => {
    expect(
      extractBearerToken(new Request(MCP_RESOURCE, { headers: { authorization: "Bearer a.b-c_d~e" } })),
    ).toBe("a.b-c_d~e");
    expect(extractBearerToken(new Request(MCP_RESOURCE))).toBeUndefined();
    expect(
      extractBearerToken(new Request(MCP_RESOURCE, { headers: { authorization: "bearer token" } })),
    ).toBe("token");
    expect(
      extractBearerToken(
        new Request(MCP_RESOURCE, { headers: { authorization: "Bearer one,Bearer two" } }),
      ),
    ).toBeUndefined();
  });

  it("advertises the complete approved initial grant to challenge-first clients", async () => {
    const result = await authenticateMcpRequest(new Request(MCP_RESOURCE));
    expect("response" in result).toBe(true);
    if ("response" in result) {
      expect(result.response.status).toBe(401);
      const challenge = result.response.headers.get("www-authenticate");
      expect(challenge).toContain("resource_metadata=");
      expect(challenge).toContain(`scope="${MCP_SCOPES.join(" ")}"`);
    }
  });

  it("requires an exact audience, allowlisted email, subject, client, and read scope", () => {
    expect(validateMcpAccessTokenPayload(principalPayload())).toMatchObject({
      clientId: "client-1",
      userId: "user-1",
      email: "owner@example.test",
    });
    for (const invalid of [
      principalPayload({ aud: [MCP_RESOURCE] }),
      principalPayload({ aud: "https://other.test/api" }),
      principalPayload({ iss: "https://wrong-issuer.test" }),
      principalPayload({ exp: Math.floor(Date.now() / 1000) - 1 }),
      principalPayload({ sub: undefined }),
      principalPayload({ azp: undefined }),
      principalPayload({ email: "removed@example.test" }),
    ]) {
      expect(() => validateMcpAccessTokenPayload(invalid)).toThrow("invalid access token");
    }
    expect(() =>
      validateMcpAccessTokenPayload(principalPayload({ scope: "openid profile" })),
    ).toThrow(MissingMcpScopeError);
  });

  it("recognizes all write tools in single and batch requests", () => {
    expect(
      requestNeedsWriteScope({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "create_nutrition_log", arguments: {} },
      }),
    ).toBe(true);
    expect(
      requestNeedsWriteScope([
        { jsonrpc: "2.0", method: "tools/list" },
        {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "acknowledge_health_updates", arguments: {} },
        },
      ]),
    ).toBe(true);
    expect(
      requestNeedsWriteScope({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "get_today_steps", arguments: {} },
      }),
    ).toBe(false);

    const response = insufficientWriteScopeResponse();
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('scope="health:write"');
    expect(response.headers.get("www-authenticate")).not.toContain("offline_access");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
