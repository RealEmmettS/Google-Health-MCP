import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { healthCache } from "../db/schema";

/**
 * Narrow read-through cache (docs/PLAN.md): v1 uses this ONLY for
 * profile/settings/identity-class lookups (TTL ~1h). Health DATA reads are
 * always live — do not widen this without a plan change.
 */
export async function readThrough<T>(
  userId: string,
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const rows = await db
    .select()
    .from(healthCache)
    .where(and(eq(healthCache.userId, userId), eq(healthCache.cacheKey, cacheKey)))
    .limit(1);
  const hit = rows[0];
  if (hit && hit.expiresAt.getTime() > Date.now()) {
    return hit.payload as T;
  }

  const fresh = await fetcher();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db
    .insert(healthCache)
    .values({ userId, cacheKey, payload: fresh as object, expiresAt })
    .onConflictDoUpdate({
      target: [healthCache.userId, healthCache.cacheKey],
      set: { payload: fresh as object, expiresAt, updatedAt: new Date() },
    });
  return fresh;
}
