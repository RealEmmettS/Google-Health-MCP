import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "../../src/auth/auth";
import {
  getAllowedSession,
  hasDisallowedSession,
} from "../../src/auth/allowed-session";
import { requireSameOriginSession } from "../../src/auth/same-origin-session";

vi.mock("../../src/auth/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const mockedGetSession = vi.mocked(auth.api.getSession);

const session = {
  user: { email: "owner@example.test" },
};

describe("allowed browser sessions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://health.example";
    process.env.ALLOWED_GOOGLE_EMAILS = "owner@example.test,owner+alias@example.test";
    mockedGetSession.mockResolvedValue(session as never);
  });

  it("returns a current session while its email remains allowlisted", async () => {
    await expect(getAllowedSession(new Headers())).resolves.toEqual(session);
  });

  it("rejects an existing session after its email is removed", async () => {
    process.env.ALLOWED_GOOGLE_EMAILS = "someone-else@example.test";

    await expect(getAllowedSession(new Headers())).resolves.toBeNull();
  });

  it("matches an approved email case-insensitively", async () => {
    mockedGetSession.mockResolvedValue({
      user: { email: "OWNER+ALIAS@EXAMPLE.TEST" },
    } as never);

    await expect(getAllowedSession(new Headers())).resolves.not.toBeNull();
  });

  it("fails closed when the allowlist is empty", async () => {
    process.env.ALLOWED_GOOGLE_EMAILS = "";

    await expect(getAllowedSession(new Headers())).resolves.toBeNull();
  });

  it("returns null when there is no browser session", async () => {
    mockedGetSession.mockResolvedValue(null as never);

    await expect(getAllowedSession(new Headers())).resolves.toBeNull();
  });

  it("distinguishes a removed session from an unauthenticated request", async () => {
    process.env.ALLOWED_GOOGLE_EMAILS = "someone-else@example.test";
    await expect(hasDisallowedSession(new Headers())).resolves.toBe(true);
    expect(mockedGetSession).toHaveBeenLastCalledWith({
      headers: expect.any(Headers),
      query: { disableCookieCache: true, disableRefresh: true },
    });

    mockedGetSession.mockResolvedValue(null as never);
    await expect(hasDisallowedSession(new Headers())).resolves.toBe(false);
  });

  it("requires both the expected origin and a currently allowed session", async () => {
    const allowedRequest = new Request("https://health.example/api/privacy/disconnect", {
      headers: { origin: "https://health.example" },
    });

    await expect(requireSameOriginSession(allowedRequest)).resolves.toEqual(session);

    process.env.ALLOWED_GOOGLE_EMAILS = "someone-else@example.test";
    await expect(requireSameOriginSession(allowedRequest)).resolves.toBeNull();
  });

  it("rejects a cross-origin request before reading its session", async () => {
    const request = new Request("https://health.example/api/privacy/disconnect", {
      headers: { origin: "https://attacker.example" },
    });

    await expect(requireSameOriginSession(request)).resolves.toBeNull();
    expect(mockedGetSession).not.toHaveBeenCalled();
  });
});
