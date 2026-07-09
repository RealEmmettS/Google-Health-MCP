import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHealthAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
} from "../../src/auth/google-health-oauth";
import {
  InvalidGrantError,
  TokenExchangeError,
} from "../../src/google-health/errors";
import { HEALTH_SCOPES } from "../../src/google-health/scopes";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("buildHealthAuthorizeUrl", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.BETTER_AUTH_URL = "https://health.example.com";
  });

  it("includes all nine health scopes, offline access, and forced consent", () => {
    const url = new URL(buildHealthAuthorizeUrl("state-abc"));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://health.example.com/api/auth/google-health/callback",
    );
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toHaveLength(9);
    for (const scope of HEALTH_SCOPES) expect(scopes).toContain(scope);
  });
});

describe("token endpoint calls", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test-secret";
    process.env.BETTER_AUTH_URL = "https://health.example.com";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges a code and parses the token response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: "ya29.test-access",
        expires_in: 3599,
        refresh_token: "1//test-refresh",
        refresh_token_expires_in: 604799,
        scope: HEALTH_SCOPES.join(" "),
        token_type: "Bearer",
      }),
    );

    const tokens = await exchangeCodeForTokens("auth-code-1");
    expect(tokens.access_token).toBe("ya29.test-access");
    expect(tokens.refresh_token).toBe("1//test-refresh");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-1");
    expect(body.get("redirect_uri")).toBe(
      "https://health.example.com/api/auth/google-health/callback",
    );
  });

  it("refreshes with grant_type=refresh_token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { access_token: "ya29.new", expires_in: 3599 }),
    );
    const tokens = await refreshAccessToken("1//stored-refresh");
    expect(tokens.access_token).toBe("ya29.new");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("1//stored-refresh");
  });

  it("maps invalid_grant to InvalidGrantError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: "invalid_grant", error_description: "expired" }),
    );
    await expect(refreshAccessToken("1//dead")).rejects.toThrow(InvalidGrantError);
  });

  it("wraps other failures in TokenExchangeError with a redacted message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: "server_error", leaked: "ya29.should-not-appear" }),
    );
    try {
      await exchangeCodeForTokens("code");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TokenExchangeError);
      expect((error as Error).message).not.toContain("ya29.");
      expect((error as Error).message).toContain("500");
    }
  });

  it("rejects a token response missing access_token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { expires_in: 3599 }));
    await expect(exchangeCodeForTokens("code")).rejects.toThrow(TokenExchangeError);
  });
});
