import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, type Db } from "../db/client";
import { oauthStates } from "../db/schema";

/**
 * DB-backed OAuth state for the Google Health consent flow (handoff §12.2):
 * hashed at rest, 10-minute expiry, strictly single-use. Consumption is one
 * atomic UPDATE, so replays lose even under concurrency.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function createOAuthState(
  intendedUserId: string,
  database: Db = db,
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await database.insert(oauthStates).values({
    stateHash: hashState(state),
    intendedUserId,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return state;
}

/**
 * Returns the state row's intended user if (and only if) the state exists,
 * is unexpired, and has never been consumed — and marks it consumed in the
 * same statement. Returns null otherwise.
 */
export async function consumeOAuthState(
  state: string,
  database: Db = db,
): Promise<{ intendedUserId: string | null } | null> {
  const rows = await database
    .update(oauthStates)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(oauthStates.stateHash, hashState(state)),
        isNull(oauthStates.consumedAt),
        gt(oauthStates.expiresAt, new Date()),
      ),
    )
    .returning({ intendedUserId: oauthStates.intendedUserId });
  return rows[0] ?? null;
}
