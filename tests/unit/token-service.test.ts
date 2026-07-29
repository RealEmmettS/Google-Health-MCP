import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InvalidGrantError,
  NotConnectedError,
  ReauthRequiredError,
} from "../../src/google-health/errors";

vi.mock("../../src/auth/token-store", () => ({
  getConnection: vi.fn(),
  loadTokenRow: vi.fn(),
  claimRefreshLock: vi.fn(),
  saveRefreshedTokensIfCurrent: vi.fn(),
  markReauthRequiredIfCurrent: vi.fn(),
  decryptAccessToken: vi.fn(),
  decryptRefreshToken: vi.fn(),
  loadGoogleHealthDpopMaterial: vi.fn(),
  saveGoogleHealthDpopNonce: vi.fn(),
}));
vi.mock("../../src/auth/google-health-oauth", () => ({
  refreshAccessToken: vi.fn(),
}));

import { refreshAccessToken } from "../../src/auth/google-health-oauth";
import { getValidAccessToken } from "../../src/auth/token-service";
import * as store from "../../src/auth/token-store";

const mocked = vi.mocked(store);
const mockedRefresh = vi.mocked(refreshAccessToken);

const CONNECTION = { id: "conn-1", status: "active", credentialVersion: 1 };

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    connectionId: "conn-1",
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    keyVersion: 1,
    credentialVersion: 1,
    dpopThumbprint: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadGoogleHealthDpopMaterial.mockResolvedValue(null);
  mocked.saveRefreshedTokensIfCurrent.mockResolvedValue(true);
  mocked.markReauthRequiredIfCurrent.mockResolvedValue(true);
  mocked.saveGoogleHealthDpopNonce.mockResolvedValue(true);
});

describe("getValidAccessToken", () => {
  it("throws NotConnectedError when no connection exists", async () => {
    mocked.getConnection.mockResolvedValue(null);
    await expect(getValidAccessToken("user-1")).rejects.toThrow(NotConnectedError);
  });

  it("throws ReauthRequiredError when the connection is flagged", async () => {
    mocked.getConnection.mockResolvedValue({ id: "c", status: "reauth_required" } as never);
    await expect(getValidAccessToken("user-1")).rejects.toThrow(ReauthRequiredError);
  });

  it("returns the stored token when fresh, without refreshing", async () => {
    mocked.getConnection.mockResolvedValue(CONNECTION as never);
    mocked.loadTokenRow.mockResolvedValue(tokenRow());
    mocked.decryptAccessToken.mockReturnValue("ya29.fresh");

    await expect(getValidAccessToken("user-1")).resolves.toBe("ya29.fresh");
    expect(mockedRefresh).not.toHaveBeenCalled();
    expect(mocked.claimRefreshLock).not.toHaveBeenCalled();
  });

  it("refreshes when the token is near expiry and persists the result", async () => {
    mocked.getConnection.mockResolvedValue(CONNECTION as never);
    mocked.loadTokenRow.mockResolvedValue(
      tokenRow({ accessTokenExpiresAt: new Date(Date.now() + 60 * 1000) }),
    );
    mocked.claimRefreshLock.mockResolvedValue(true);
    mocked.decryptRefreshToken.mockReturnValue("1//refresh");
    mockedRefresh.mockResolvedValue({ access_token: "ya29.renewed", expires_in: 3599 });

    await expect(getValidAccessToken("user-1")).resolves.toBe("ya29.renewed");
    expect(mockedRefresh).toHaveBeenCalledWith("1//refresh", undefined);
    expect(mocked.saveRefreshedTokensIfCurrent).toHaveBeenCalledWith(
      "conn-1",
      1,
      undefined,
      { access_token: "ya29.renewed", expires_in: 3599 },
    );
  });

  it("marks reauth_required and throws when refresh hits invalid_grant", async () => {
    mocked.getConnection.mockResolvedValue(CONNECTION as never);
    mocked.loadTokenRow.mockResolvedValue(
      tokenRow({ accessTokenExpiresAt: new Date(Date.now() - 1000) }),
    );
    mocked.claimRefreshLock.mockResolvedValue(true);
    mocked.decryptRefreshToken.mockReturnValue("1//dead");
    mockedRefresh.mockRejectedValue(new InvalidGrantError());

    await expect(getValidAccessToken("user-1")).rejects.toThrow(ReauthRequiredError);
    expect(mocked.markReauthRequiredIfCurrent).toHaveBeenCalledWith("conn-1", 1);
  });

  it("uses the stored DPoP key and persists a rotated Google nonce", async () => {
    mocked.getConnection.mockResolvedValue(CONNECTION as never);
    mocked.loadTokenRow.mockResolvedValue(
      tokenRow({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        dpopThumbprint: "thumbprint",
      }),
    );
    mocked.claimRefreshLock.mockResolvedValue(true);
    mocked.decryptRefreshToken.mockReturnValue("1//bound-refresh");
    const material = {
      privateJwk: { kty: "EC" },
      publicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
      thumbprint: "thumbprint",
      nonce: "old-nonce",
      credentialVersion: 1,
    } as never;
    mocked.loadGoogleHealthDpopMaterial.mockResolvedValue(material);
    mockedRefresh.mockResolvedValue({
      access_token: "ya29.bound",
      expires_in: 3599,
      dpopNonce: "new-nonce",
    });

    await expect(getValidAccessToken("user-1")).resolves.toBe("ya29.bound");
    expect(mockedRefresh).toHaveBeenCalledWith(
      "1//bound-refresh",
      expect.objectContaining({ material, onNonce: expect.any(Function) }),
    );
    expect(mocked.saveGoogleHealthDpopNonce).toHaveBeenCalledWith(
      "conn-1",
      1,
      "thumbprint",
      "new-nonce",
    );
  });

  it("marks reauth_required when no refresh token is stored", async () => {
    mocked.getConnection.mockResolvedValue(CONNECTION as never);
    mocked.loadTokenRow.mockResolvedValue(
      tokenRow({ accessTokenExpiresAt: new Date(Date.now() - 1000) }),
    );
    mocked.claimRefreshLock.mockResolvedValue(true);
    mocked.decryptRefreshToken.mockReturnValue(null);

    await expect(getValidAccessToken("user-1")).rejects.toThrow(ReauthRequiredError);
    expect(mocked.markReauthRequiredIfCurrent).toHaveBeenCalledWith("conn-1", 1);
  });

  it("waits for a concurrent refresher and returns its token", async () => {
    vi.useFakeTimers();
    try {
      mocked.getConnection.mockResolvedValue(CONNECTION as never);
      const staleRow = tokenRow({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
      });
      const freshRow = tokenRow({
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      mocked.loadTokenRow
        .mockResolvedValueOnce(staleRow) // initial read
        .mockResolvedValueOnce(staleRow) // first poll: still stale
        .mockResolvedValue(freshRow); // subsequent polls: winner wrote
      mocked.claimRefreshLock.mockResolvedValue(false);
      mocked.decryptAccessToken.mockReturnValue("ya29.from-winner");

      const promise = getValidAccessToken("user-1");
      await vi.advanceTimersByTimeAsync(2000);
      await expect(promise).resolves.toBe("ya29.from-winner");
      expect(mockedRefresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes over the refresh when the lock holder never writes", async () => {
    vi.useFakeTimers();
    try {
      mocked.getConnection.mockResolvedValue(CONNECTION as never);
      mocked.loadTokenRow.mockResolvedValue(
        tokenRow({ accessTokenExpiresAt: new Date(Date.now() - 1000) }),
      );
      mocked.claimRefreshLock
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mocked.decryptAccessToken.mockReturnValue(null);
      mocked.decryptRefreshToken.mockReturnValue("1//refresh");
      mockedRefresh.mockResolvedValue({ access_token: "ya29.takeover", expires_in: 3599 });

      const promise = getValidAccessToken("user-1");
      await vi.advanceTimersByTimeAsync(61 * 500 + 100);
      await expect(promise).resolves.toBe("ya29.takeover");
      expect(mockedRefresh).toHaveBeenCalledTimes(1);
      expect(mocked.claimRefreshLock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards a refresh result when reconnect advances the credential generation", async () => {
    const staleRow = tokenRow({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
    const replacementRow = tokenRow({
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      credentialVersion: 2,
    });
    mocked.getConnection
      .mockResolvedValueOnce(CONNECTION as never)
      .mockResolvedValueOnce({ ...CONNECTION, credentialVersion: 2 } as never);
    mocked.loadTokenRow
      .mockResolvedValueOnce(staleRow)
      .mockResolvedValueOnce(replacementRow);
    mocked.claimRefreshLock.mockResolvedValue(true);
    mocked.decryptRefreshToken.mockReturnValue("1//stale");
    mockedRefresh.mockResolvedValue({ access_token: "ya29.stale", expires_in: 3599 });
    mocked.saveRefreshedTokensIfCurrent.mockResolvedValue(false);
    mocked.decryptAccessToken.mockReturnValue("ya29.reconnected");

    await expect(getValidAccessToken("user-1")).resolves.toBe("ya29.reconnected");
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mocked.markReauthRequiredIfCurrent).not.toHaveBeenCalled();
  });

  it("does not mark a replacement credential when stale invalid_grant loses its CAS", async () => {
    const staleRow = tokenRow({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
    const replacementRow = tokenRow({
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      credentialVersion: 2,
    });
    mocked.getConnection
      .mockResolvedValueOnce(CONNECTION as never)
      .mockResolvedValueOnce({ ...CONNECTION, credentialVersion: 2 } as never);
    mocked.loadTokenRow
      .mockResolvedValueOnce(staleRow)
      .mockResolvedValueOnce(replacementRow);
    mocked.claimRefreshLock.mockResolvedValue(true);
    mocked.decryptRefreshToken.mockReturnValue("1//stale");
    mockedRefresh.mockRejectedValue(new InvalidGrantError());
    mocked.markReauthRequiredIfCurrent.mockResolvedValue(false);
    mocked.decryptAccessToken.mockReturnValue("ya29.reconnected");

    await expect(getValidAccessToken("user-1")).resolves.toBe("ya29.reconnected");
    expect(mocked.markReauthRequiredIfCurrent).toHaveBeenCalledWith("conn-1", 1);
  });

  it("does not report reauthorization when a missing-token CAS loses repeatedly", async () => {
    mocked.getConnection.mockResolvedValue(CONNECTION as never);
    mocked.loadTokenRow.mockResolvedValue(
      tokenRow({ accessTokenExpiresAt: new Date(Date.now() - 1000) }),
    );
    mocked.claimRefreshLock.mockResolvedValue(true);
    mocked.decryptRefreshToken.mockReturnValue(null);
    mocked.markReauthRequiredIfCurrent.mockResolvedValue(false);

    await expect(getValidAccessToken("user-1")).rejects.toThrow(
      "Google Health credentials changed during refresh.",
    );
    expect(mocked.getConnection).toHaveBeenCalledTimes(3);
  });

  it("does not report reauthorization when an invalid-grant CAS loses repeatedly", async () => {
    mocked.getConnection.mockResolvedValue(CONNECTION as never);
    mocked.loadTokenRow.mockResolvedValue(
      tokenRow({ accessTokenExpiresAt: new Date(Date.now() - 1000) }),
    );
    mocked.claimRefreshLock.mockResolvedValue(true);
    mocked.decryptRefreshToken.mockReturnValue("1//stale");
    mockedRefresh.mockRejectedValue(new InvalidGrantError());
    mocked.markReauthRequiredIfCurrent.mockResolvedValue(false);

    await expect(getValidAccessToken("user-1")).rejects.toThrow(
      "Google Health credentials changed during refresh.",
    );
    expect(mocked.getConnection).toHaveBeenCalledTimes(3);
  });
});
