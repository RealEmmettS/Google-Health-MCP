import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareGoogleHealthDpopKey } from "../../src/auth/google-health-dpop";
import {
  claimRefreshLock,
  commitDpopCredentialReplacement,
  decryptAccessToken,
  decryptRefreshToken,
  loadGoogleHealthDpopMaterial,
  loadTokenRow,
  saveRefreshedTokensIfCurrent,
} from "../../src/auth/token-store";
import { db } from "../../src/db/client";
import { appUsers, oauthConnections } from "../../src/db/schema";

const enabled =
  process.env.RUN_DB_INTEGRATION === "rehearsal-only" &&
  !!process.env.DATABASE_URL;

const userId = randomUUID();
const connectionId = randomUUID();
const alternateConnectionId = randomUUID();
const email = `mcp-030-rehearsal-${userId}@example.invalid`;

async function removeFailureConstraints() {
  await db.execute(
    sql`alter table "oauth_tokens" drop constraint if exists "test_mcp030_token_write"`,
  );
  await db.execute(
    sql`alter table "google_health_dpop_key" drop constraint if exists "test_mcp030_dpop_write"`,
  );
}

async function removeDelayTrigger() {
  await db.execute(
    sql`drop trigger if exists "test_mcp030_delay_reconnect" on "oauth_tokens"`,
  );
  await db.execute(sql`drop function if exists "test_mcp030_delay_reconnect"()`);
}

async function waitForDelayedReconnect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await db.execute(sql`
      select count(*)::int as "count"
      from pg_stat_activity
      where "wait_event" = 'PgSleep'
        and "query" like '%insert into "oauth_connections"%'
    `);
    if (Number((result.rows?.[0] as { count?: unknown } | undefined)?.count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Reconnect statement did not reach the forced interleaving point");
}

async function snapshot() {
  const connection = (
    await db
      .select({ credentialVersion: oauthConnections.credentialVersion })
      .from(oauthConnections)
      .where(eq(oauthConnections.id, connectionId))
      .limit(1)
  )[0];
  const token = await loadTokenRow(connectionId);
  const dpop = await loadGoogleHealthDpopMaterial(connectionId);
  if (!connection || !token || !dpop) throw new Error("Incomplete rehearsal credential");
  return {
    accessToken: decryptAccessToken(token),
    credentialVersion: connection.credentialVersion,
    refreshToken: decryptRefreshToken(token),
    thumbprint: dpop.thumbprint,
  };
}

describe.skipIf(!enabled)("Google Health credential replacement on PostgreSQL", () => {
  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 47).toString("base64");
    await removeFailureConstraints();
    await removeDelayTrigger();
    await db.insert(appUsers).values({ id: userId, email });
  });

  afterAll(async () => {
    await removeFailureConstraints();
    await removeDelayTrigger();
    await db.delete(appUsers).where(eq(appUsers.id, userId));
  });

  it("commits initial and same-ID replacement credentials as one triplet", async () => {
    const firstKey = await prepareGoogleHealthDpopKey(connectionId);
    await commitDpopCredentialReplacement({
      appUserId: userId,
      connectionId,
      dpopKey: firstKey,
      grantedScopes: ["scope:first"],
      tokens: {
        access_token: "test-access-first",
        expires_in: 3600,
        refresh_token: "test-refresh-first",
      },
    });
    expect(await snapshot()).toEqual({
      accessToken: "test-access-first",
      credentialVersion: 1,
      refreshToken: "test-refresh-first",
      thumbprint: firstKey.material.thumbprint,
    });

    const secondKey = await prepareGoogleHealthDpopKey(connectionId);
    await commitDpopCredentialReplacement({
      appUserId: userId,
      connectionId,
      dpopKey: secondKey,
      grantedScopes: ["scope:second"],
      tokens: {
        access_token: "test-access-second",
        expires_in: 3600,
        refresh_token: "test-refresh-second",
      },
    });
    expect(await snapshot()).toEqual({
      accessToken: "test-access-second",
      credentialVersion: 2,
      refreshToken: "test-refresh-second",
      thumbprint: secondKey.material.thumbprint,
    });
  });

  it("rejects a different connection ID and preserves the current triplet", async () => {
    const before = await snapshot();
    const key = await prepareGoogleHealthDpopKey(alternateConnectionId);
    await expect(
      commitDpopCredentialReplacement({
        appUserId: userId,
        connectionId: alternateConnectionId,
        dpopKey: key,
        grantedScopes: ["scope:wrong-id"],
        tokens: {
          access_token: "test-access-wrong-id",
          expires_in: 3600,
          refresh_token: "test-refresh-wrong-id",
        },
      }),
    ).rejects.toThrow("did not commit");
    expect(await snapshot()).toEqual(before);
  });

  it("rejects stale refresh and lock writes after a reconnect wins the row lock", async () => {
    const before = await snapshot();
    const tokenRow = await loadTokenRow(connectionId);
    if (!tokenRow) throw new Error("Missing rehearsal token row");

    await db.execute(
      sql.raw(`
        create function "test_mcp030_delay_reconnect"() returns trigger
        language plpgsql as $$
        begin
          if new."credential_version" > old."credential_version" then
            perform pg_sleep(2);
          end if;
          return new;
        end
        $$
      `),
    );
    await db.execute(sql.raw(`
      create trigger "test_mcp030_delay_reconnect"
      before update of "credential_version" on "oauth_tokens"
      for each row execute function "test_mcp030_delay_reconnect"()
    `));

    try {
      const replacementKey = await prepareGoogleHealthDpopKey(connectionId);
      const replacement = commitDpopCredentialReplacement({
        appUserId: userId,
        connectionId,
        dpopKey: replacementKey,
        grantedScopes: ["scope:concurrent-reconnect"],
        tokens: {
          access_token: "test-access-concurrent-reconnect",
          expires_in: 3600,
          refresh_token: "test-refresh-concurrent-reconnect",
        },
      });
      await waitForDelayedReconnect();

      const [saved, claimed] = await Promise.all([
        saveRefreshedTokensIfCurrent(
          connectionId,
          before.credentialVersion,
          before.thumbprint,
          { access_token: "test-access-stale-refresh", expires_in: 3600 },
        ),
        claimRefreshLock(
          tokenRow.id,
          connectionId,
          before.credentialVersion,
          before.thumbprint,
          10_000,
        ),
      ]);
      await replacement;

      expect(saved).toBe(false);
      expect(claimed).toBe(false);
      expect(await snapshot()).toEqual({
        accessToken: "test-access-concurrent-reconnect",
        credentialVersion: before.credentialVersion + 1,
        refreshToken: "test-refresh-concurrent-reconnect",
        thumbprint: replacementKey.material.thumbprint,
      });
    } finally {
      await removeDelayTrigger();
    }
  });

  it("rolls back the connection and key when the token write fails", async () => {
    const before = await snapshot();
    await db.execute(
      sql.raw(
        `alter table "oauth_tokens" add constraint "test_mcp030_token_write" ` +
          `check ("connection_id" <> '${connectionId}'::uuid) not valid`,
      ),
    );
    try {
      const key = await prepareGoogleHealthDpopKey(connectionId);
      await expect(
        commitDpopCredentialReplacement({
          appUserId: userId,
          connectionId,
          dpopKey: key,
          grantedScopes: ["scope:token-failure"],
          tokens: {
            access_token: "test-access-token-failure",
            expires_in: 3600,
            refresh_token: "test-refresh-token-failure",
          },
        }),
      ).rejects.toThrow();
    } finally {
      await removeFailureConstraints();
    }
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back the connection and token when the DPoP key write fails", async () => {
    const before = await snapshot();
    await db.execute(
      sql.raw(
        `alter table "google_health_dpop_key" add constraint "test_mcp030_dpop_write" ` +
          `check ("connection_id" <> '${connectionId}'::uuid) not valid`,
      ),
    );
    try {
      const key = await prepareGoogleHealthDpopKey(connectionId);
      await expect(
        commitDpopCredentialReplacement({
          appUserId: userId,
          connectionId,
          dpopKey: key,
          grantedScopes: ["scope:key-failure"],
          tokens: {
            access_token: "test-access-key-failure",
            expires_in: 3600,
            refresh_token: "test-refresh-key-failure",
          },
        }),
      ).rejects.toThrow();
    } finally {
      await removeFailureConstraints();
    }
    expect(await snapshot()).toEqual(before);
  });
});
