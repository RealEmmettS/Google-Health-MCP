import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deleteExpiredHealthCache,
  type HealthCacheStore,
  invalidateHealthCache,
  readThroughEncrypted,
  type StoredHealthCache,
} from "../../src/health-services/cache";

class MemoryCacheStore implements HealthCacheStore {
  readonly rows = new Map<string, StoredHealthCache>();
  readonly deletedKeys: string[] = [];

  private key(userId: string, cacheKey: string): string {
    return `${userId}:${cacheKey}`;
  }

  async get(userId: string, cacheKey: string) {
    return this.rows.get(this.key(userId, cacheKey));
  }

  async upsert(row: StoredHealthCache) {
    this.rows.set(this.key(row.userId, row.cacheKey), structuredClone(row));
  }

  async deleteKey(userId: string, cacheKey: string) {
    const key = this.key(userId, cacheKey);
    this.deletedKeys.push(key);
    this.rows.delete(key);
  }

  async deleteForUser(userId: string, dataType?: string) {
    let deleted = 0;
    for (const [key, row] of this.rows) {
      if (row.userId === userId && (!dataType || row.dataType === dataType)) {
        this.rows.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async deleteExpired(now: Date) {
    let deleted = 0;
    for (const [key, row] of this.rows) {
      if (row.expiresAt.getTime() < now.getTime()) {
        this.rows.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

const policy = {
  userId: "user-a",
  cacheKey: "steps-request",
  dataType: "steps",
  operation: "rollUp",
  ttlSeconds: 120,
};

describe("encrypted health response cache", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("stores ciphertext and reuses an unexpired exact response", async () => {
    const store = new MemoryCacheStore();
    const fetcher = vi.fn(async () => ({ buckets: [{ count: 4217 }] }));

    const first = await readThroughEncrypted(policy, fetcher, store);
    const second = await readThroughEncrypted(policy, fetcher, store);

    expect(first.provenance.source).toBe("live");
    expect(second.provenance.source).toBe("cache");
    expect(second.value).toEqual(first.value);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...store.rows.values()])).not.toContain("4217");
  });

  it("bypasses cache explicitly and replaces the row", async () => {
    const store = new MemoryCacheStore();
    let value = 1;
    await readThroughEncrypted(policy, async () => ({ value: value++ }), store);
    const refreshed = await readThroughEncrypted(
      { ...policy, bypass: true },
      async () => ({ value: value++ }),
      store,
    );

    expect(refreshed.provenance.source).toBe("live");
    expect(refreshed.value).toEqual({ value: 2 });
  });

  it("does not return an expired row", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
      const store = new MemoryCacheStore();
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ generation: 1 })
        .mockResolvedValueOnce({ generation: 2 });
      await readThroughEncrypted({ ...policy, ttlSeconds: 1 }, fetcher, store);

      vi.setSystemTime(new Date("2026-07-25T12:00:02Z"));
      const result = await readThroughEncrypted(
        { ...policy, ttlSeconds: 1 },
        fetcher,
        store,
      );

      expect(result.value).toEqual({ generation: 2 });
      expect(result.provenance.source).toBe("live");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when ciphertext is copied to another user", async () => {
    const store = new MemoryCacheStore();
    await readThroughEncrypted(policy, async () => ({ privateValue: 58 }), store);
    const original = store.rows.get("user-a:steps-request");
    expect(original).toBeDefined();
    store.rows.set("user-b:steps-request", {
      ...structuredClone(original!),
      userId: "user-b",
    });

    const result = await readThroughEncrypted(
      { ...policy, userId: "user-b" },
      async () => ({ privateValue: 63 }),
      store,
    );

    expect(result.value).toEqual({ privateValue: 63 });
    expect(result.provenance.source).toBe("live");
    expect(store.deletedKeys).toContain("user-b:steps-request");
  });

  it("deletes a rolling-deploy plaintext-only row instead of serving it", async () => {
    const store = new MemoryCacheStore();
    await readThroughEncrypted(policy, async () => ({ generation: 1 }), store);
    const row = store.rows.get("user-a:steps-request")!;
    store.rows.set("user-a:steps-request", {
      ...row,
      payloadCiphertext: null,
      payloadIv: null,
      payloadTag: null,
    });

    const result = await readThroughEncrypted(
      policy,
      async () => ({ generation: 2 }),
      store,
    );

    expect(result.value).toEqual({ generation: 2 });
    expect(result.provenance.source).toBe("live");
    expect(store.deletedKeys).toContain("user-a:steps-request");
  });

  it("invalidates only the requested user and data type", async () => {
    const store = new MemoryCacheStore();
    await readThroughEncrypted(policy, async () => ({ value: 1 }), store);
    await readThroughEncrypted(
      { ...policy, cacheKey: "sleep-request", dataType: "sleep" },
      async () => ({ value: 2 }),
      store,
    );
    await readThroughEncrypted(
      { ...policy, userId: "user-b" },
      async () => ({ value: 3 }),
      store,
    );

    expect(await invalidateHealthCache("user-a", "steps", store)).toBe(1);
    expect([...store.rows.values()].map((row) => `${row.userId}:${row.dataType}`)).toEqual(
      ["user-a:sleep", "user-b:steps"],
    );
  });

  it("deletes only rows older than the retention cutoff", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
      const store = new MemoryCacheStore();
      await readThroughEncrypted(
        { ...policy, cacheKey: "short", ttlSeconds: 1 },
        async () => ({ value: 1 }),
        store,
      );
      await readThroughEncrypted(
        { ...policy, cacheKey: "long", ttlSeconds: 60 },
        async () => ({ value: 2 }),
        store,
      );

      expect(
        await deleteExpiredHealthCache(new Date("2026-07-25T12:00:02Z"), store),
      ).toBe(1);
      expect([...store.rows.values()].map((row) => row.cacheKey)).toEqual(["long"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
