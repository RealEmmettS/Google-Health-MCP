import {
  InvalidGrantError,
  NotConnectedError,
  ReauthRequiredError,
} from "../google-health/errors";
import { refreshAccessToken } from "./google-health-oauth";
import {
  claimRefreshLock,
  decryptAccessToken,
  decryptRefreshToken,
  getConnection,
  loadTokenRow,
  markReauthRequired,
  saveTokens,
} from "./token-store";

/**
 * getValidAccessToken (docs/PLAN.md §"Security invariants"): returns a usable
 * Google access token for the user, refreshing when <5 minutes remain.
 *
 * Single-flight: neon-http cannot hold interactive transactions, so instead of
 * SELECT..FOR UPDATE this uses a claimable lock column
 * (refresh_in_flight_until). Losers poll briefly for the winner's write, then
 * take over if the winner appears dead. Google refresh tokens are not rotated
 * on use, so a rare concurrent double-refresh is harmless.
 */

const REFRESH_EARLY_MS = 5 * 60 * 1000;
const LOCK_DURATION_MS = 30 * 1000;
const WAIT_POLL_MS = 500;
const WAIT_POLL_ATTEMPTS = 8;

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
  const connection = await getConnection(appUserId);
  if (!connection) throw new NotConnectedError();
  if (connection.status !== "active") throw new ReauthRequiredError();

  const row = await loadTokenRow(connection.id);
  if (!row) throw new ReauthRequiredError();

  if (!options.forceRefresh && isFresh(row.accessTokenExpiresAt)) {
    const token = decryptAccessToken(row);
    if (token) return token;
  }

  // Stale (or undecryptable) access token — refresh path.
  const claimed = await claimRefreshLock(row.id, LOCK_DURATION_MS);
  if (!claimed) {
    // Another invocation is refreshing; wait for its write to land.
    for (let i = 0; i < WAIT_POLL_ATTEMPTS; i++) {
      await sleep(WAIT_POLL_MS);
      const fresh = await loadTokenRow(connection.id);
      if (fresh && isFresh(fresh.accessTokenExpiresAt)) {
        const token = decryptAccessToken(fresh);
        if (token) return token;
      }
    }
    // Winner appears dead; fall through and refresh ourselves (benign for
    // Google even if both end up refreshing).
  }

  const refreshToken = decryptRefreshToken(row);
  if (!refreshToken) {
    await markReauthRequired(connection.id);
    throw new ReauthRequiredError();
  }

  try {
    const refreshed = await refreshAccessToken(refreshToken);
    await saveTokens(connection.id, refreshed);
    return refreshed.access_token;
  } catch (error) {
    if (error instanceof InvalidGrantError) {
      await markReauthRequired(connection.id);
      throw new ReauthRequiredError();
    }
    throw error;
  }
}
