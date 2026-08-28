import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAllowedSession } from "../../src/auth/allowed-session";
import { getOrCreateAppUser } from "../../src/auth/app-user";
import {
  exchangeCodeForTokens,
  appBaseUrl,
} from "../../src/auth/google-health-oauth";
import { consumeOAuthState, createOAuthState } from "../../src/auth/state";
import { GET as startGoogleHealth } from "../../app/api/auth/google-health/start/route";
import { GET as completeGoogleHealth } from "../../app/api/auth/google-health/callback/route";

vi.mock("../../src/auth/allowed-session", () => ({
  getAllowedSession: vi.fn(),
}));
vi.mock("../../src/auth/app-user", () => ({
  getOrCreateAppUser: vi.fn(),
}));
vi.mock("../../src/auth/google-health-oauth", () => ({
  appBaseUrl: vi.fn(() => "https://health.example"),
  buildHealthAuthorizeUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  fetchHealthIdentity: vi.fn(),
}));
vi.mock("../../src/auth/google-health-dpop", () => ({
  prepareGoogleHealthDpopKey: vi.fn(),
}));
vi.mock("../../src/auth/state", () => ({
  consumeOAuthState: vi.fn(),
  createOAuthState: vi.fn(),
}));
vi.mock("../../src/auth/token-store", () => ({
  commitDpopCredentialReplacement: vi.fn(),
  getConnection: vi.fn(),
}));
vi.mock("../../src/db/client", () => ({
  db: {},
}));
vi.mock("../../src/db/schema", () => ({
  appUsers: {},
}));
vi.mock("../../src/security/redact", () => ({
  redactError: vi.fn((error) => error),
}));

const mockedAllowedSession = vi.mocked(getAllowedSession);
const mockedGetOrCreateAppUser = vi.mocked(getOrCreateAppUser);
const mockedAppBaseUrl = vi.mocked(appBaseUrl);
const mockedExchangeCode = vi.mocked(exchangeCodeForTokens);
const mockedConsumeState = vi.mocked(consumeOAuthState);
const mockedCreateState = vi.mocked(createOAuthState);

describe("Google Health browser-session gates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedAppBaseUrl.mockReturnValue("https://health.example");
    mockedAllowedSession.mockResolvedValue(null);
  });

  it("does not start consent for a stale de-allowlisted session", async () => {
    const response = await startGoogleHealth(
      new Request("https://health.example/api/auth/google-health/start"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://health.example/sign-in");
    expect(mockedGetOrCreateAppUser).not.toHaveBeenCalled();
    expect(mockedCreateState).not.toHaveBeenCalled();
  });

  it("does not consume state or exchange a code for a removed session", async () => {
    const response = await completeGoogleHealth(
      new Request(
        "https://health.example/api/auth/google-health/callback?code=code-1&state=state-1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://health.example/sign-in");
    expect(mockedConsumeState).not.toHaveBeenCalled();
    expect(mockedExchangeCode).not.toHaveBeenCalled();
    expect(mockedGetOrCreateAppUser).not.toHaveBeenCalled();
  });
});
