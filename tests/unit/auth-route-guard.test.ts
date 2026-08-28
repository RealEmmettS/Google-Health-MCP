import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasDisallowedSession } from "../../src/auth/allowed-session";
import { rejectDisallowedAuthSession } from "../../src/auth/auth-route-guard";

vi.mock("../../src/auth/allowed-session", () => ({
  hasDisallowedSession: vi.fn(),
}));

const mockedHasDisallowedSession = vi.mocked(hasDisallowedSession);

describe("Better Auth route allowlist guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("leaves public auth and OAuth requests usable without a removed session", async () => {
    mockedHasDisallowedSession.mockResolvedValue(false);
    const request = new Request("https://health.example/api/auth/oauth2/register", {
      method: "POST",
    });

    await expect(rejectDisallowedAuthSession(request)).resolves.toBeNull();
  });

  it("blocks Better Auth and OAuth-provider use by a removed browser session", async () => {
    mockedHasDisallowedSession.mockResolvedValue(true);
    const request = new Request("https://health.example/api/auth/oauth2/authorize");

    const response = await rejectDisallowedAuthSession(request);

    expect(response?.status).toBe(403);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    await expect(response?.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("keeps sign-out reachable so a removed user can clear the stale cookie", async () => {
    mockedHasDisallowedSession.mockResolvedValue(true);
    const request = new Request("https://health.example/api/auth/sign-out", {
      method: "POST",
    });

    await expect(rejectDisallowedAuthSession(request)).resolves.toBeNull();
    expect(mockedHasDisallowedSession).not.toHaveBeenCalled();
  });
});
