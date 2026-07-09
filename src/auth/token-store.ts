import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { oauthConnections, oauthTokens } from "../db/schema";
import {
  CURRENT_KEY_VERSION,
  decryptSecret,
  encryptSecret,
} from "../security/encryption";
import type { GoogleTokenResponse } from "./google-health-oauth";

/**
 * Persistence for the Google Health connection + encrypted tokens.
 * Plaintext tokens exist only transiently in memory here — the DB columns
 * hold ciphertext/iv/tag exclusively.
 */

export type OAuthConnection = typeof oauthConnections.$inferSelect;
export type OAuthTokenRow = typeof oauthTokens.$inferSelect;

const PROVIDER = "google_health";

export async function getConnection(userId: string): Promise<OAuthConnection | null> {
  const rows = await db
    .select()
    .from(oauthConnections)
    .where(
      and(eq(oauthConnections.userId, userId), eq(oauthConnections.provider, PROVIDER)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Reconnects update the existing row — never duplicate (handoff §6.1). */
export async function upsertConnection(
  userId: string,
  grantedScopes: string[],
): Promise<OAuthConnection> {
  const rows = await db
    .insert(oauthConnections)
    .values({ userId, provider: PROVIDER, scopes: grantedScopes, status: "active" })
    .onConflictDoUpdate({
      target: [oauthConnections.userId, oauthConnections.provider],
      set: {
        scopes: grantedScopes,
        status: "active",
        connectedAt: new Date(),
        reauthRequiredAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

export async function markReauthRequired(connectionId: string): Promise<void> {
  await db
    .update(oauthConnections)
    .set({ status: "reauth_required", reauthRequiredAt: new Date(), updatedAt: new Date() })
    .where(eq(oauthConnections.id, connectionId));
}

export async function loadTokenRow(connectionId: string): Promise<OAuthTokenRow | null> {
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.connectionId, connectionId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Encrypts and upserts the token row for a connection. When Google omits the
 * refresh token (it only returns one on first consent / prompt=consent), the
 * existing stored refresh token is preserved.
 */
export async function saveTokens(
  connectionId: string,
  tokens: GoogleTokenResponse,
): Promise<void> {
  const now = Date.now();
  const access = encryptSecret(tokens.access_token);
  const accessExpiresAt = new Date(now + tokens.expires_in * 1000);

  const refresh = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null;
  const refreshExpiresAt =
    tokens.refresh_token && tokens.refresh_token_expires_in
      ? new Date(now + tokens.refresh_token_expires_in * 1000)
      : undefined;

  const base = {
    accessTokenCiphertext: access.ciphertext,
    accessTokenIv: access.iv,
    accessTokenTag: access.tag,
    accessTokenExpiresAt: accessExpiresAt,
    tokenType: tokens.token_type ?? "Bearer",
    keyVersion: CURRENT_KEY_VERSION,
    refreshInFlightUntil: null,
    updatedAt: new Date(),
  };

  const refreshFields = refresh
    ? {
        refreshTokenCiphertext: refresh.ciphertext,
        refreshTokenIv: refresh.iv,
        refreshTokenTag: refresh.tag,
        ...(refreshExpiresAt ? { refreshTokenExpiresAt: refreshExpiresAt } : {}),
      }
    : {};

  await db
    .insert(oauthTokens)
    .values({ connectionId, ...base, ...refreshFields })
    .onConflictDoUpdate({
      target: oauthTokens.connectionId,
      // Refresh fields are included ONLY when Google returned a new refresh
      // token — otherwise the stored one survives the update untouched.
      set: { ...base, ...refreshFields },
    });
}

/**
 * Best-effort single-flight refresh lock: claims succeed when no live lock
 * exists. One atomic UPDATE — safe on the stateless neon-http driver.
 */
export async function claimRefreshLock(
  tokenRowId: string,
  durationMs: number,
): Promise<boolean> {
  const rows = await db
    .update(oauthTokens)
    .set({ refreshInFlightUntil: new Date(Date.now() + durationMs) })
    .where(
      and(
        eq(oauthTokens.id, tokenRowId),
        or(
          isNull(oauthTokens.refreshInFlightUntil),
          lt(oauthTokens.refreshInFlightUntil, sql`now()`),
        ),
      ),
    )
    .returning({ id: oauthTokens.id });
  return rows.length > 0;
}

export function decryptAccessToken(row: OAuthTokenRow): string | null {
  if (!row.accessTokenCiphertext || !row.accessTokenIv || !row.accessTokenTag) {
    return null;
  }
  return decryptSecret({
    ciphertext: row.accessTokenCiphertext,
    iv: row.accessTokenIv,
    tag: row.accessTokenTag,
    keyVersion: row.keyVersion,
  });
}

export function decryptRefreshToken(row: OAuthTokenRow): string | null {
  if (!row.refreshTokenCiphertext || !row.refreshTokenIv || !row.refreshTokenTag) {
    return null;
  }
  return decryptSecret({
    ciphertext: row.refreshTokenCiphertext,
    iv: row.refreshTokenIv,
    tag: row.refreshTokenTag,
    keyVersion: row.keyVersion,
  });
}
