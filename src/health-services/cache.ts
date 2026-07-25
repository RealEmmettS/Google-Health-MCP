import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/client";
import { healthCache } from "../db/schema";
import {
  CURRENT_KEY_VERSION,
  decryptJson,
  encryptJson,
  EncryptionError,
} from "../security/encryption";

const CACHE_PURPOSE = "google-health-response-cache-v1";

export interface CachePolicy {
  userId: string;
  cacheKey: string;
  dataType?: string;
  operation: string;
  ttlSeconds: number;
  rangeStart?: Date;
  rangeEnd?: Date;
  bypass?: boolean;
}

export interface CacheProvenance {
  source: "live" | "cache";
  fetchedAt: string;
  cachedAt?: string;
  expiresAt?: string;
}

export interface CachedResult<T> {
  value: T;
  provenance: CacheProvenance;
}

export interface StoredHealthCache {
  userId: string;
  cacheKey: string;
  dataType: string | null;
  operation: string;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  payloadCiphertext: string | null;
  payloadIv: string | null;
  payloadTag: string | null;
  keyVersion: number;
  sourceFetchedAt: Date;
  expiresAt: Date;
  updatedAt: Date;
}

export interface HealthCacheStore {
  get(userId: string, cacheKey: string): Promise<StoredHealthCache | undefined>;
  upsert(row: StoredHealthCache): Promise<void>;
  deleteKey(userId: string, cacheKey: string): Promise<void>;
  deleteForUser(userId: string, dataType?: string): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
}

function aad(userId: string, cacheKey: string): string {
  return `health-cache:${userId}:${cacheKey}`;
}

const dbCacheStore: HealthCacheStore = {
  async get(userId, cacheKey) {
    const rows = await db
      .select()
      .from(healthCache)
      .where(
        and(eq(healthCache.userId, userId), eq(healthCache.cacheKey, cacheKey)),
      )
      .limit(1);
    return rows[0];
  },
  async upsert(row) {
    await db
      .insert(healthCache)
      .values(row)
      .onConflictDoUpdate({
        target: [healthCache.userId, healthCache.cacheKey],
        set: {
          dataType: row.dataType,
          operation: row.operation,
          rangeStart: row.rangeStart,
          rangeEnd: row.rangeEnd,
          payloadCiphertext: row.payloadCiphertext,
          payloadIv: row.payloadIv,
          payloadTag: row.payloadTag,
          keyVersion: row.keyVersion,
          sourceFetchedAt: row.sourceFetchedAt,
          expiresAt: row.expiresAt,
          updatedAt: row.updatedAt,
        },
      });
  },
  async deleteKey(userId, cacheKey) {
    await db
      .delete(healthCache)
      .where(
        and(eq(healthCache.userId, userId), eq(healthCache.cacheKey, cacheKey)),
      );
  },
  async deleteForUser(userId, dataType) {
    const deleted = await db
      .delete(healthCache)
      .where(
        dataType
          ? and(eq(healthCache.userId, userId), eq(healthCache.dataType, dataType))
          : eq(healthCache.userId, userId),
      )
      .returning({ id: healthCache.id });
    return deleted.length;
  },
  async deleteExpired(now) {
    const deleted = await db
      .delete(healthCache)
      .where(lt(healthCache.expiresAt, now))
      .returning({ id: healthCache.id });
    return deleted.length;
  },
};

/**
 * Read-through cache for exact Google API responses. Database rows contain
 * ciphertext only; user/cache-key AAD prevents a valid row being swapped
 * across users or operations.
 */
export async function readThroughEncrypted<T>(
  policy: CachePolicy,
  fetcher: () => Promise<T>,
  store: HealthCacheStore = dbCacheStore,
): Promise<CachedResult<T>> {
  if (!policy.bypass) {
    const hit = await store.get(policy.userId, policy.cacheKey);
    if (hit && hit.expiresAt.getTime() > Date.now()) {
      if (!hit.payloadCiphertext || !hit.payloadIv || !hit.payloadTag) {
        // Rolling-deploy compatibility: v0.1.x may have written a
        // plaintext-only row after the additive migration but before v0.2.0
        // became live. Never read it; remove and refill encrypted.
        await store.deleteKey(policy.userId, policy.cacheKey);
      } else {
        try {
          return {
            value: decryptJson<T>(
              {
                ciphertext: hit.payloadCiphertext,
                iv: hit.payloadIv,
                tag: hit.payloadTag,
                keyVersion: hit.keyVersion,
              },
              CACHE_PURPOSE,
              aad(policy.userId, policy.cacheKey),
            ),
            provenance: {
              source: "cache",
              fetchedAt: hit.sourceFetchedAt.toISOString(),
              cachedAt: hit.updatedAt.toISOString(),
              expiresAt: hit.expiresAt.toISOString(),
            },
          };
        } catch (error) {
          if (!(error instanceof EncryptionError)) throw error;
          // Corrupt/old-key rows fail closed and are replaced from Google.
          await store.deleteKey(policy.userId, policy.cacheKey);
        }
      }
    }
  }

  const value = await fetcher();
  const sourceFetchedAt = new Date();
  const expiresAt = new Date(sourceFetchedAt.getTime() + policy.ttlSeconds * 1000);
  const encrypted = encryptJson(
    value,
    CACHE_PURPOSE,
    aad(policy.userId, policy.cacheKey),
    CURRENT_KEY_VERSION,
  );

  await store.upsert({
    userId: policy.userId,
    cacheKey: policy.cacheKey,
    dataType: policy.dataType ?? null,
    operation: policy.operation,
    rangeStart: policy.rangeStart ?? null,
    rangeEnd: policy.rangeEnd ?? null,
    payloadCiphertext: encrypted.ciphertext,
    payloadIv: encrypted.iv,
    payloadTag: encrypted.tag,
    keyVersion: encrypted.keyVersion,
    sourceFetchedAt,
    expiresAt,
    updatedAt: sourceFetchedAt,
  });

  return {
    value,
    provenance: {
      source: "live",
      fetchedAt: sourceFetchedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/** Conservative invalidation: remove every cached operation for a data type. */
export async function invalidateHealthCache(
  userId: string,
  dataType?: string,
  store: HealthCacheStore = dbCacheStore,
): Promise<number> {
  return store.deleteForUser(userId, dataType);
}

export async function deleteExpiredHealthCache(
  now = new Date(),
  store: HealthCacheStore = dbCacheStore,
): Promise<number> {
  return store.deleteExpired(now);
}
