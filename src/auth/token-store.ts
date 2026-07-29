import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  googleHealthDpopKey,
  oauthConnections,
  oauthTokens,
} from "../db/schema";
import {
  CURRENT_KEY_VERSION,
  decryptSecret,
  encryptSecret,
} from "../security/encryption";
import type { GoogleTokenResponse } from "./google-health-oauth";
import {
  restoreGoogleHealthDpopMaterial,
  type GoogleHealthDpopMaterial,
  type PreparedGoogleHealthDpopKey,
} from "./google-health-dpop";

/**
 * Persistence for the Google Health connection + encrypted tokens.
 * Plaintext tokens exist only transiently in memory here — the DB columns
 * hold ciphertext/iv/tag exclusively.
 */

export type OAuthConnection = typeof oauthConnections.$inferSelect;
export type OAuthTokenRow = typeof oauthTokens.$inferSelect;
export type GoogleHealthDpopKeyRow = typeof googleHealthDpopKey.$inferSelect;

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
        credentialVersion: sql`${oauthConnections.credentialVersion} + 1`,
        connectedAt: new Date(),
        reauthRequiredAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

export async function markReauthRequiredIfCurrent(
  connectionId: string,
  credentialVersion: number,
): Promise<boolean> {
  const rows = await db
    .update(oauthConnections)
    .set({ status: "reauth_required", reauthRequiredAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(oauthConnections.id, connectionId),
        eq(oauthConnections.credentialVersion, credentialVersion),
      ),
    )
    .returning({ id: oauthConnections.id });
  return rows.length > 0;
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
export async function saveRefreshedTokensIfCurrent(
  connectionId: string,
  credentialVersion: number,
  expectedDpopThumbprint: string | undefined,
  tokens: GoogleTokenResponse,
): Promise<boolean> {
  const now = Date.now();
  const access = encryptSecret(tokens.access_token);
  const accessExpiresAt = new Date(now + tokens.expires_in * 1000);

  const refresh = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null;
  const refreshExpiresAt =
    tokens.refresh_token && tokens.refresh_token_expires_in
      ? new Date(now + tokens.refresh_token_expires_in * 1000)
      : undefined;

  const hasRefresh = refresh !== null;
  const result = await db.execute(sql`
    update "oauth_tokens" set
      "access_token_ciphertext" = ${access.ciphertext},
      "access_token_iv" = ${access.iv},
      "access_token_tag" = ${access.tag},
      "access_token_expires_at" = ${accessExpiresAt},
      "refresh_token_ciphertext" = case when ${hasRefresh}
        then ${refresh?.ciphertext ?? null} else "refresh_token_ciphertext" end,
      "refresh_token_iv" = case when ${hasRefresh}
        then ${refresh?.iv ?? null} else "refresh_token_iv" end,
      "refresh_token_tag" = case when ${hasRefresh}
        then ${refresh?.tag ?? null} else "refresh_token_tag" end,
      "refresh_token_expires_at" = case when ${hasRefresh}
        then ${refreshExpiresAt ?? null} else "refresh_token_expires_at" end,
      "token_type" = ${tokens.token_type ?? "Bearer"},
      "key_version" = ${CURRENT_KEY_VERSION},
      "refresh_in_flight_until" = null,
      "updated_at" = now()
    where "connection_id" = ${connectionId}::uuid
      and "credential_version" = ${credentialVersion}
      and "dpop_thumbprint" is not distinct from ${expectedDpopThumbprint ?? null}
    returning "id"
  `);
  return !!result.rows?.length;
}

function textArray(values: string[]) {
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * Atomically replaces a Google Health credential set after a successful DPoP
 * authorization-code exchange. Until this single statement commits, the
 * prior connection, encrypted refresh token, and DPoP key remain untouched.
 */
export async function commitDpopCredentialReplacement(input: {
  appUserId: string;
  connectionId: string;
  dpopKey: PreparedGoogleHealthDpopKey;
  grantedScopes: string[];
  tokens: GoogleTokenResponse;
}): Promise<void> {
  if (input.dpopKey.connectionId !== input.connectionId) {
    throw new Error("Google Health DPoP key belongs to a different connection");
  }
  if (!input.tokens.refresh_token) {
    throw new Error("Google did not return a replacement refresh token");
  }

  const now = Date.now();
  const access = encryptSecret(input.tokens.access_token);
  const refresh = encryptSecret(input.tokens.refresh_token);
  const accessExpiresAt = new Date(now + input.tokens.expires_in * 1000);
  const refreshExpiresAt = input.tokens.refresh_token_expires_in
    ? new Date(now + input.tokens.refresh_token_expires_in * 1000)
    : null;
  const scopes = textArray(input.grantedScopes);
  const publicJwk = JSON.stringify(input.dpopKey.material.publicJwk);
  const encryptedPrivate = input.dpopKey.encryptedPrivateJwk;

  const result = await db.execute(sql`
    with connection as (
      insert into "oauth_connections" (
        "id", "user_id", "provider", "scopes", "status", "credential_version", "connected_at",
        "reauth_required_at", "created_at", "updated_at"
      ) values (
        ${input.connectionId}::uuid, ${input.appUserId}::uuid, ${PROVIDER},
        ${scopes}, 'active', 1, now(), null, now(), now()
      )
      on conflict ("user_id", "provider") do update set
        "scopes" = excluded."scopes",
        "status" = 'active',
        "credential_version" = "oauth_connections"."credential_version" + 1,
        "connected_at" = now(),
        "reauth_required_at" = null,
        "updated_at" = now()
      where "oauth_connections"."id" = excluded."id"
      returning "id", "credential_version"
    ), token_write as (
      insert into "oauth_tokens" (
        "connection_id", "access_token_ciphertext", "access_token_iv",
        "access_token_tag", "access_token_expires_at",
        "refresh_token_ciphertext", "refresh_token_iv", "refresh_token_tag",
        "refresh_token_expires_at", "token_type", "key_version",
        "credential_version", "dpop_thumbprint", "refresh_in_flight_until",
        "created_at", "updated_at"
      )
      select
        "id", ${access.ciphertext}, ${access.iv}, ${access.tag},
        ${accessExpiresAt}, ${refresh.ciphertext}, ${refresh.iv}, ${refresh.tag},
        ${refreshExpiresAt}, ${input.tokens.token_type ?? "Bearer"},
        ${CURRENT_KEY_VERSION}, "credential_version",
        ${input.dpopKey.material.thumbprint}, null, now(), now()
      from connection
      on conflict ("connection_id") do update set
        "access_token_ciphertext" = excluded."access_token_ciphertext",
        "access_token_iv" = excluded."access_token_iv",
        "access_token_tag" = excluded."access_token_tag",
        "access_token_expires_at" = excluded."access_token_expires_at",
        "refresh_token_ciphertext" = excluded."refresh_token_ciphertext",
        "refresh_token_iv" = excluded."refresh_token_iv",
        "refresh_token_tag" = excluded."refresh_token_tag",
        "refresh_token_expires_at" = excluded."refresh_token_expires_at",
        "token_type" = excluded."token_type",
        "key_version" = excluded."key_version",
        "credential_version" = excluded."credential_version",
        "dpop_thumbprint" = excluded."dpop_thumbprint",
        "refresh_in_flight_until" = null,
        "updated_at" = now()
      returning "connection_id"
    ), dpop_write as (
      insert into "google_health_dpop_key" (
        "connection_id", "private_jwk_ciphertext", "private_jwk_iv",
        "private_jwk_tag", "key_version", "credential_version", "public_jwk",
        "thumbprint", "nonce", "created_at", "updated_at"
      )
      select
        "id", ${encryptedPrivate.ciphertext}, ${encryptedPrivate.iv},
        ${encryptedPrivate.tag}, ${encryptedPrivate.keyVersion}, "credential_version",
        ${publicJwk}::jsonb, ${input.dpopKey.material.thumbprint},
        ${input.tokens.dpopNonce ?? null}, now(), now()
      from connection
      on conflict ("connection_id") do update set
        "private_jwk_ciphertext" = excluded."private_jwk_ciphertext",
        "private_jwk_iv" = excluded."private_jwk_iv",
        "private_jwk_tag" = excluded."private_jwk_tag",
        "key_version" = excluded."key_version",
        "credential_version" = excluded."credential_version",
        "public_jwk" = excluded."public_jwk",
        "thumbprint" = excluded."thumbprint",
        "nonce" = excluded."nonce",
        "updated_at" = now()
      returning "connection_id"
    )
    select "id" from connection
    where exists (select 1 from token_write)
      and exists (select 1 from dpop_write)
  `);

  if (!result.rows?.length) {
    throw new Error("Google Health credential replacement did not commit");
  }
}

export async function loadGoogleHealthDpopMaterial(
  connectionId: string,
): Promise<(GoogleHealthDpopMaterial & { credentialVersion: number }) | null> {
  const row = (
    await db
      .select()
      .from(googleHealthDpopKey)
      .where(eq(googleHealthDpopKey.connectionId, connectionId))
      .limit(1)
  )[0];
  if (!row) return null;
  return restoreGoogleHealthDpopMaterial({
    connectionId,
    encryptedPrivateJwk: {
      ciphertext: row.privateJwkCiphertext,
      iv: row.privateJwkIv,
      tag: row.privateJwkTag,
      keyVersion: row.keyVersion,
    },
    nonce: row.nonce,
    publicJwk: row.publicJwk,
    thumbprint: row.thumbprint,
  }).then((material) => ({ ...material, credentialVersion: row.credentialVersion }));
}

export async function saveGoogleHealthDpopNonce(
  connectionId: string,
  credentialVersion: number,
  expectedThumbprint: string,
  nonce: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    update "google_health_dpop_key" set
      "nonce" = ${nonce},
      "updated_at" = now()
    where "connection_id" = ${connectionId}::uuid
      and "credential_version" = ${credentialVersion}
      and "thumbprint" = ${expectedThumbprint}
    returning "id"
  `);
  return !!result.rows?.length;
}

/**
 * Best-effort single-flight refresh lock: claims succeed when no live lock
 * exists. One atomic UPDATE — safe on the stateless neon-http driver.
 */
export async function claimRefreshLock(
  tokenRowId: string,
  connectionId: string,
  credentialVersion: number,
  expectedDpopThumbprint: string | undefined,
  durationMs: number,
): Promise<boolean> {
  const result = await db.execute(sql`
    update "oauth_tokens" set
      "refresh_in_flight_until" = now() + (${durationMs} * interval '1 millisecond')
    where "id" = ${tokenRowId}
      and "connection_id" = ${connectionId}::uuid
      and "credential_version" = ${credentialVersion}
      and "dpop_thumbprint" is not distinct from ${expectedDpopThumbprint ?? null}
      and ("refresh_in_flight_until" is null or "refresh_in_flight_until" < now())
    returning "id"
  `);
  return !!result.rows?.length;
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
