import {
  InvalidDpopProofError,
  InvalidGrantError,
  NotConnectedError,
  ReauthRequiredError,
  TokenExchangeError,
} from "../google-health/errors";
import { refreshAccessToken } from "./google-health-oauth";
import {
  claimRefreshLock,
  decryptAccessToken,
  decryptRefreshToken,
  getConnection,
  loadGoogleHealthDpopMaterial,
  loadTokenRow,
  markReauthRequiredIfCurrent,
  saveGoogleHealthDpopNonce,
  saveRefreshedTokensIfCurrent,
} from "./token-store";

/**
 * getValidAccessToken (docs/PLAN.md §"Security invariants"): returns a usable
 * Google access token for the user, refreshing when <5 minutes remain.
 *
 * Single-flight: neon-http cannot hold interactive transactions, so instead of
 * SELECT..FOR UPDATE this uses a claimable lock column
 * (refresh_in_flight_until). Losers poll briefly for the winner's write, then
 * take over only after reacquiring the expired lock. DPoP nonce state makes a
 * concurrent double-refresh unsafe, even when Google does not rotate the
 * refresh token itself.
 */

const REFRESH_EARLY_MS = 5 * 60 * 1000;
// One nonce challenge can produce two independent 8s token calls. Keep the DB
// lease comfortably beyond that complete path and make contenders poll past it.
const LOCK_DURATION_MS = 30 * 1000;
const WAIT_POLL_MS = 500;
const WAIT_POLL_ATTEMPTS = 61;
const GENERATION_RETRY_LIMIT = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isFresh(expiresAt: Date | null): boolean {
  return !!expiresAt && expiresAt.getTime() - Date.now() > REFRESH_EARLY_MS;
}

export interface GetTokenOptions {
  /**
   * Skip the freshness shortcut and refresh now — used after Google rejects a
   * token that still looked fresh locally (revocation, clock skew).
   */
  forceRefresh?: boolean;
}

export async function getValidAccessToken(
  appUserId: string,
  options: GetTokenOptions = {},
): Promise<string> {
  return getValidAccessTokenForGeneration(appUserId, options, 0);
}

async function getValidAccessTokenForGeneration(
  appUserId: string,
  options: GetTokenOptions,
  generationAttempt: number,
): Promise<string> {
  const connection = await getConnection(appUserId);
  if (!connection) throw new NotConnectedError();
  if (connection.status !== "active") throw new ReauthRequiredError();

  const row = await loadTokenRow(connection.id);
  if (!row) throw new ReauthRequiredError();
  if (row.credentialVersion !== connection.credentialVersion) {
    if (generationAttempt < GENERATION_RETRY_LIMIT) {
      return getValidAccessTokenForGeneration(appUserId, options, generationAttempt + 1);
    }
    throw new TokenExchangeError("Google Health credentials changed during refresh.");
  }

  if (!options.forceRefresh && isFresh(row.accessTokenExpiresAt)) {
    const token = decryptAccessToken(row);
    if (token) return token;
  }

  const dpop = await loadGoogleHealthDpopMaterial(connection.id);
  if (
    row.dpopThumbprint !== (dpop?.thumbprint ?? null) ||
    (dpop && dpop.credentialVersion !== connection.credentialVersion)
  ) {
    if (generationAttempt < GENERATION_RETRY_LIMIT) {
      return getValidAccessTokenForGeneration(appUserId, options, generationAttempt + 1);
    }
    throw new TokenExchangeError("Google Health credentials changed during refresh.");
  }
  const dpopThumbprint = dpop?.thumbprint;

  // Stale (or undecryptable) access token — refresh path.
  let claimed = await claimRefreshLock(
    row.id,
    connection.id,
    connection.credentialVersion,
    dpopThumbprint,
    LOCK_DURATION_MS,
  );
  if (!claimed) {
    // Another invocation is refreshing; wait for its write to land.
    for (let i = 0; i < WAIT_POLL_ATTEMPTS; i++) {
      await sleep(WAIT_POLL_MS);
      const fresh = await loadTokenRow(connection.id);
      if (
        fresh &&
        fresh.credentialVersion === connection.credentialVersion &&
        fresh.dpopThumbprint === (dpopThumbprint ?? null) &&
        isFresh(fresh.accessTokenExpiresAt)
      ) {
        const token = decryptAccessToken(fresh);
        if (token) return token;
      } else if (fresh && fresh.credentialVersion !== connection.credentialVersion) {
        if (generationAttempt < GENERATION_RETRY_LIMIT) {
          return getValidAccessTokenForGeneration(
            appUserId,
            { forceRefresh: false },
            generationAttempt + 1,
          );
        }
        throw new TokenExchangeError("Google Health credentials changed during refresh.");
      }
    }
    // The endpoint timeout is shorter than this lock. Reacquire before any
    // takeover so DPoP refreshes never run concurrently by design.
    claimed = await claimRefreshLock(
      row.id,
      connection.id,
      connection.credentialVersion,
      dpopThumbprint,
      LOCK_DURATION_MS,
    );
    if (!claimed) {
      if (generationAttempt < GENERATION_RETRY_LIMIT) {
        return getValidAccessTokenForGeneration(
          appUserId,
          { forceRefresh: false },
          generationAttempt + 1,
        );
      }
      throw new TokenExchangeError("Google Health credential refresh is already in progress.");
    }
  }

  const refreshToken = decryptRefreshToken(row);
  if (!refreshToken) {
    const marked = await markReauthRequiredIfCurrent(
      connection.id,
      connection.credentialVersion,
    );
    if (!marked && generationAttempt < GENERATION_RETRY_LIMIT) {
      return getValidAccessTokenForGeneration(
        appUserId,
        { forceRefresh: false },
        generationAttempt + 1,
      );
    }
    if (!marked) {
      throw new TokenExchangeError("Google Health credentials changed during refresh.");
    }
    throw new ReauthRequiredError();
  }

  try {
    const refreshed = await refreshAccessToken(
      refreshToken,
      dpop
        ? {
            material: dpop,
            onNonce: async (nonce) => {
              await saveGoogleHealthDpopNonce(
                connection.id,
                connection.credentialVersion,
                dpop.thumbprint,
                nonce,
              );
            },
          }
        : undefined,
    );
    const saved = await saveRefreshedTokensIfCurrent(
      connection.id,
      connection.credentialVersion,
      dpopThumbprint,
      refreshed,
    );
    if (!saved) {
      if (generationAttempt < GENERATION_RETRY_LIMIT) {
        return getValidAccessTokenForGeneration(
          appUserId,
          { forceRefresh: false },
          generationAttempt + 1,
        );
      }
      throw new TokenExchangeError("Google Health credentials changed during refresh.");
    }
    if (dpop && refreshed.dpopNonce) {
      await saveGoogleHealthDpopNonce(
        connection.id,
        connection.credentialVersion,
        dpop.thumbprint,
        refreshed.dpopNonce,
      );
    }
    return refreshed.access_token;
  } catch (error) {
    if (error instanceof InvalidGrantError || error instanceof InvalidDpopProofError) {
      const marked = await markReauthRequiredIfCurrent(
        connection.id,
        connection.credentialVersion,
      );
      if (!marked && generationAttempt < GENERATION_RETRY_LIMIT) {
        return getValidAccessTokenForGeneration(
          appUserId,
          { forceRefresh: false },
          generationAttempt + 1,
        );
      }
      if (!marked) {
        throw new TokenExchangeError("Google Health credentials changed during refresh.");
      }
      throw new ReauthRequiredError();
    }
    throw error;
  }
}
