import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppUserByEmail } from "../../src/auth/app-user";
import { requireSameOriginSession } from "../../src/auth/same-origin-session";
import {
  deleteStoredHealthData,
  disconnectGoogleHealth,
} from "../../src/health-services/data-controls";
import { POST as disconnect } from "../../app/api/privacy/disconnect/route";
import { POST as deleteHealthData } from "../../app/api/privacy/delete-health-data/route";

vi.mock("../../src/auth/app-user", () => ({
  getAppUserByEmail: vi.fn(),
}));
vi.mock("../../src/auth/same-origin-session", () => ({
  requireSameOriginSession: vi.fn(),
}));
vi.mock("../../src/health-services/data-controls", () => ({
  disconnectGoogleHealth: vi.fn(),
  deleteStoredHealthData: vi.fn(),
}));

const mockedSession = vi.mocked(requireSameOriginSession);
const mockedUser = vi.mocked(getAppUserByEmail);
const mockedDisconnect = vi.mocked(disconnectGoogleHealth);
const mockedDelete = vi.mocked(deleteStoredHealthData);

function request(path: string, body?: unknown) {
  return new Request(`https://health.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://health.example",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("privacy control routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedSession.mockResolvedValue({
      user: { email: "emmett@example.com" },
    } as Awaited<ReturnType<typeof requireSameOriginSession>>);
    mockedUser.mockResolvedValue({ id: "app-user-a" } as never);
  });

  it("scopes disconnect to the authenticated session's domain user", async () => {
    mockedDisconnect.mockResolvedValue({
      disconnected: true,
      googleRevocation: "revoked",
    });
    const response = await disconnect(request("/api/privacy/disconnect"));

    expect(response.status).toBe(200);
    expect(mockedUser).toHaveBeenCalledWith("emmett@example.com");
    expect(mockedDisconnect).toHaveBeenCalledWith("app-user-a");
  });

  it("does not touch any user when origin or current-allowlist checks fail", async () => {
    mockedSession.mockResolvedValue(null);
    const response = await disconnect(request("/api/privacy/disconnect"));

    expect(response.status).toBe(401);
    expect(mockedUser).not.toHaveBeenCalled();
    expect(mockedDisconnect).not.toHaveBeenCalled();
  });

  it("requires the exact destructive confirmation phrase", async () => {
    const response = await deleteHealthData(
      request("/api/privacy/delete-health-data", { confirmation: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("deletes only the authenticated session's resolved Health domain user", async () => {
    mockedDelete.mockResolvedValue({
      deleted: true,
      googleRevocation: "revoked",
    });
    const response = await deleteHealthData(
      request("/api/privacy/delete-health-data", {
        confirmation: "DELETE MY STORED HEALTH DATA",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalledWith("app-user-a");
  });
});
