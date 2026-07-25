import { createHash } from "node:crypto";
import { getValidAccessToken } from "../auth/token-service";
import { getConnection } from "../auth/token-store";
import {
  invalidateHealthCache,
  readThroughEncrypted,
  type CacheProvenance,
} from "../health-services/cache";
import { redactString } from "../security/redact";
import type { CivilRange, PhysicalRange } from "../time/ranges";
import {
  GoogleApiError,
  GoogleHealthError,
  MissingScopeError,
  NotConnectedError,
  RateLimitedError,
} from "./errors";
import {
  type DataTypeOp,
  type DataTypeSpec,
  getDataType,
  readScopeFor,
  supportsOp,
  writeScopeFor,
} from "./registry";

const API_BASE = "https://health.googleapis.com/v4";
const MAX_PAGE_SIZE = 100;
const READ_RETRIES = 2;
const READ_DEADLINE_MS = 12_000;
const MAX_CONCURRENT_GOOGLE_REQUESTS = 3;
const CURRENT_DATA_TTL_SECONDS = 120;
const HISTORICAL_DATA_TTL_SECONDS = 1800;
const PROFILE_TTL_SECONDS = 3600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ListArgs {
  dataType: string;
  filter?: string;
  pageSize?: number;
  pageToken?: string;
}

export interface ReconcileArgs extends ListArgs {
  dataSourceFamily?: string;
}

export interface DataPointPage {
  dataPoints: unknown[];
  nextPageToken?: string;
}

export interface RollupArgs {
  dataType: string;
  range: PhysicalRange;
  windowSize: string;
}

export interface DailyRollupArgs {
  dataType: string;
  range: CivilRange;
  windowSizeDays: number;
}

export interface RollupResult {
  rollupDataPoints: unknown[];
}

export interface DataProvenance {
  source: "live" | "cache" | "mixed" | "none";
  operations: number;
  liveOperations: number;
  cachedOperations: number;
  oldestSourceFetch?: string;
  newestSourceFetch?: string;
}

interface ReadCacheMetadata {
  operation: string;
  dataType?: string;
  ttlSeconds: number;
  rangeStart?: Date;
  rangeEnd?: Date;
}

export interface GoogleHealthClientOptions {
  cacheEnabled?: boolean;
}

type WriteOp = Extract<DataTypeOp, "create" | "update" | "batchDelete">;

function resolveSpec(dataType: string): DataTypeSpec {
  const spec = getDataType(dataType);
  if (!spec) {
    throw new GoogleHealthError(
      "unknown_data_type",
      `Unknown or unsupported data type "${dataType}".`,
    );
  }
  return spec;
}

function requiredScope(spec: DataTypeSpec, op: DataTypeOp): string {
  const writes: readonly DataTypeOp[] = ["create", "update", "batchDelete"];
  return writes.includes(op) ? writeScopeFor(spec) : readScopeFor(spec);
}

function hashRequest(path: string, init: RequestInit): string {
  const method = (init.method ?? "GET").toUpperCase();
  return createHash("sha256")
    .update(method)
    .update("\0")
    .update(path)
    .update("\0")
    .update(typeof init.body === "string" ? init.body : "")
    .digest("hex");
}

function dateFromCivilPart(value: unknown): Date | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const date = rec.date as Record<string, unknown> | undefined;
  if (!date) return undefined;
  const year = Number(date.year);
  const month = Number(date.month);
  const day = Number(date.day);
  if (!year || !month || !day) return undefined;
  return new Date(Date.UTC(year, month - 1, day));
}

function dailyRangeBounds(range: CivilRange): { start?: Date; end?: Date } {
  return {
    start: dateFromCivilPart(range.start),
    end: dateFromCivilPart(range.end),
  };
}

function ttlForRangeEnd(end?: Date): number {
  if (!end) return CURRENT_DATA_TTL_SECONDS;
  return end.getTime() < Date.now() - 24 * 60 * 60 * 1000
    ? HISTORICAL_DATA_TTL_SECONDS
    : CURRENT_DATA_TTL_SECONDS;
}

export class GoogleHealthClient {
  private grantedScopesPromise: Promise<string[]> | null = null;
  private accessTokenPromise: Promise<string> | null = null;
  private cacheBypass = false;
  private readonly cacheEnabled: boolean;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly provenance: CacheProvenance[] = [];
  private activeGoogleRequests = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly appUserId: string,
    options: GoogleHealthClientOptions = {},
  ) {
    this.cacheEnabled = options.cacheEnabled ?? process.env.NODE_ENV !== "test";
  }

  setCacheBypass(bypass: boolean): void {
    this.cacheBypass = bypass;
  }

  getDataProvenance(): DataProvenance {
    if (this.provenance.length === 0) {
      return { source: "none", operations: 0, liveOperations: 0, cachedOperations: 0 };
    }
    const liveOperations = this.provenance.filter((p) => p.source === "live").length;
    const cachedOperations = this.provenance.length - liveOperations;
    const times = this.provenance
      .map((p) => p.fetchedAt)
      .filter(Boolean)
      .sort();
    return {
      source:
        liveOperations > 0 && cachedOperations > 0
          ? "mixed"
          : liveOperations > 0
            ? "live"
            : "cache",
      operations: this.provenance.length,
      liveOperations,
      cachedOperations,
      oldestSourceFetch: times[0],
      newestSourceFetch: times.at(-1),
    };
  }

  private async grantedScopes(): Promise<string[]> {
    if (!this.grantedScopesPromise) {
      this.grantedScopesPromise = getConnection(this.appUserId)
        .then((connection) => {
          if (!connection) throw new NotConnectedError();
          return connection.scopes;
        })
        .catch((error) => {
          this.grantedScopesPromise = null;
          throw error;
        });
    }
    return this.grantedScopesPromise;
  }

  private accessToken(forceRefresh: boolean): Promise<string> {
    if (!this.accessTokenPromise || forceRefresh) {
      const promise = getValidAccessToken(this.appUserId, { forceRefresh }).catch(
        (error) => {
          if (this.accessTokenPromise === promise) this.accessTokenPromise = null;
          throw error;
        },
      );
      this.accessTokenPromise = promise;
    }
    return this.accessTokenPromise;
  }

  private async precheck(dataType: string, op: DataTypeOp): Promise<DataTypeSpec> {
    const spec = resolveSpec(dataType);
    if (!supportsOp(spec.kebab, op)) {
      throw new GoogleHealthError(
        "unsupported_operation",
        `Data type "${spec.kebab}" does not support the "${op}" operation.`,
      );
    }
    const scope = requiredScope(spec, op);
    const granted = await this.grantedScopes();
    if (!granted.includes(scope)) {
      throw new MissingScopeError([scope]);
    }
    return spec;
  }

  private async withGoogleSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeGoogleRequests >= MAX_CONCURRENT_GOOGLE_REQUESTS) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.activeGoogleRequests += 1;
    try {
      return await fn();
    } finally {
      this.activeGoogleRequests -= 1;
      this.waiters.shift()?.();
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.withGoogleSlot(() =>
        fetch(url, { ...init, signal: controller.signal }),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestNetwork<T>(
    path: string,
    init: RequestInit,
    isRead: boolean,
  ): Promise<T> {
    const deadline = Date.now() + READ_DEADLINE_MS;
    let forceRefresh = false;
    let retryAttempt = 0;

    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new GoogleApiError(504, "Google Health API read deadline exceeded.");
      }

      const token = await this.accessToken(forceRefresh);
      let response: Response;
      try {
        response = await this.fetchWithTimeout(
          `${API_BASE}${path}`,
          {
            ...init,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              ...(init.body ? { "Content-Type": "application/json" } : {}),
              ...(init.headers ?? {}),
            },
          },
          Math.min(remaining, READ_DEADLINE_MS),
        );
      } catch (error) {
        if (isRead && retryAttempt < READ_RETRIES && Date.now() < deadline) {
          retryAttempt += 1;
          await sleep(Math.min(250 * 2 ** retryAttempt, deadline - Date.now()));
          continue;
        }
        const name = error instanceof Error ? error.name : "NetworkError";
        throw new GoogleApiError(
          name === "AbortError" ? 504 : 503,
          name === "AbortError"
            ? "Google Health API read timed out."
            : "Google Health API network request failed.",
        );
      }

      if (response.status === 401 && !forceRefresh) {
        forceRefresh = true;
        continue;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 30;
        if (isRead && retryAttempt < READ_RETRIES) {
          retryAttempt += 1;
          const waitMs = Math.min(
            Math.max(250 * 2 ** retryAttempt, retryAfter * 1000),
            2000,
            Math.max(0, deadline - Date.now()),
          );
          if (waitMs > 0) {
            await sleep(waitMs);
            continue;
          }
        }
        throw new RateLimitedError(retryAfter);
      }

      if (
        isRead &&
        [502, 503, 504].includes(response.status) &&
        retryAttempt < READ_RETRIES
      ) {
        retryAttempt += 1;
        await sleep(Math.min(250 * 2 ** retryAttempt, Math.max(0, deadline - Date.now())));
        continue;
      }

      const text = await response.text();
      if (!response.ok) {
        throw new GoogleApiError(
          response.status,
          `Google Health API ${response.status} on ${path.split("?")[0]}: ${redactString(text).slice(0, 300)}`,
        );
      }
      return (text ? JSON.parse(text) : {}) as T;
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    cache?: ReadCacheMetadata,
  ): Promise<T> {
    if (!cache) return this.requestNetwork<T>(path, init, false);

    const cacheKey = hashRequest(path, init);
    const existing = this.inFlight.get(cacheKey) as Promise<T> | undefined;
    if (existing) return existing;

    const startedAt = Date.now();
    const promise = this.cacheEnabled
      ? readThroughEncrypted<T>(
          {
            userId: this.appUserId,
            cacheKey,
            dataType: cache.dataType,
            operation: cache.operation,
            ttlSeconds: cache.ttlSeconds,
            rangeStart: cache.rangeStart,
            rangeEnd: cache.rangeEnd,
            bypass: this.cacheBypass,
          },
          () => this.requestNetwork<T>(path, init, true),
        ).then(({ value, provenance }) => {
          this.provenance.push(provenance);
          console.info(
            JSON.stringify({
              event: "google_health_read",
              operation: cache.operation,
              dataType: cache.dataType ?? null,
              source: provenance.source,
              durationMs: Date.now() - startedAt,
            }),
          );
          return value;
        })
      : this.requestNetwork<T>(path, init, true);

    this.inFlight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  async listDataPoints(args: ListArgs): Promise<DataPointPage> {
    const spec = await this.precheck(args.dataType, "list");
    const params = new URLSearchParams();
    if (args.filter) params.set("filter", args.filter);
    params.set("pageSize", String(Math.min(args.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)));
    if (args.pageToken) params.set("pageToken", args.pageToken);
    return this.request<DataPointPage>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints?${params.toString()}`,
      {},
      {
        operation: "list",
        dataType: spec.kebab,
        ttlSeconds: CURRENT_DATA_TTL_SECONDS,
      },
    );
  }

  async reconcileDataPoints(args: ReconcileArgs): Promise<DataPointPage> {
    const spec = await this.precheck(args.dataType, "reconcile");
    const params = new URLSearchParams();
    if (args.dataSourceFamily) params.set("dataSourceFamily", args.dataSourceFamily);
    if (args.filter) params.set("filter", args.filter);
    params.set("pageSize", String(Math.min(args.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)));
    if (args.pageToken) params.set("pageToken", args.pageToken);
    return this.request<DataPointPage>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints:reconcile?${params.toString()}`,
      {},
      {
        operation: "reconcile",
        dataType: spec.kebab,
        ttlSeconds: CURRENT_DATA_TTL_SECONDS,
      },
    );
  }

  async getDataPoint(name: string): Promise<unknown> {
    const dataType = name.match(/\/dataTypes\/([^/]+)\//)?.[1];
    return this.request<unknown>(`/${name}`, {}, {
      operation: "get",
      dataType,
      ttlSeconds: CURRENT_DATA_TTL_SECONDS,
    });
  }

  async rollUp(args: RollupArgs): Promise<RollupResult> {
    const spec = await this.precheck(args.dataType, "rollup");
    const rangeStart = new Date(args.range.startTime);
    const rangeEnd = new Date(args.range.endTime);
    return this.request<RollupResult>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints:rollUp`,
      {
        method: "POST",
        body: JSON.stringify({ range: args.range, windowSize: args.windowSize }),
      },
      {
        operation: "rollUp",
        dataType: spec.kebab,
        ttlSeconds: ttlForRangeEnd(rangeEnd),
        rangeStart,
        rangeEnd,
      },
    );
  }

  async dailyRollUp(args: DailyRollupArgs): Promise<RollupResult> {
    const spec = await this.precheck(args.dataType, "dailyRollup");
    const bounds = dailyRangeBounds(args.range);
    return this.request<RollupResult>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints:dailyRollUp`,
      {
        method: "POST",
        body: JSON.stringify({
          range: args.range,
          windowSizeDays: args.windowSizeDays,
        }),
      },
      {
        operation: "dailyRollUp",
        dataType: spec.kebab,
        ttlSeconds: ttlForRangeEnd(bounds.end),
        rangeStart: bounds.start,
        rangeEnd: bounds.end,
      },
    );
  }

  async createDataPoint(dataType: string, body: unknown): Promise<unknown> {
    const spec = await this.precheck(dataType, "create");
    const result = await this.request<unknown>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints`,
      { method: "POST", body: JSON.stringify(body) },
    );
    if (this.cacheEnabled) await invalidateHealthCache(this.appUserId, spec.kebab);
    return result;
  }

  async patchDataPoint(
    dataType: string,
    name: string,
    body: unknown,
  ): Promise<unknown> {
    const spec = await this.precheck(dataType, "update");
    const result = await this.request<unknown>(`/${name}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (this.cacheEnabled) await invalidateHealthCache(this.appUserId, spec.kebab);
    return result;
  }

  async batchDeleteDataPoints(dataType: string, names: string[]): Promise<unknown> {
    const spec = await this.precheck(dataType, "batchDelete");
    const result = await this.request<unknown>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints:batchDelete`,
      { method: "POST", body: JSON.stringify({ names }) },
    );
    if (this.cacheEnabled) await invalidateHealthCache(this.appUserId, spec.kebab);
    return result;
  }

  async getIdentity(): Promise<unknown> {
    return this.request<unknown>("/users/me/identity", {}, {
      operation: "getIdentity",
      ttlSeconds: PROFILE_TTL_SECONDS,
    });
  }

  async getProfile(): Promise<unknown> {
    return this.request<unknown>("/users/me/profile", {}, {
      operation: "getProfile",
      ttlSeconds: PROFILE_TTL_SECONDS,
    });
  }

  async getSettings(): Promise<unknown> {
    return this.request<unknown>("/users/me/settings", {}, {
      operation: "getSettings",
      ttlSeconds: PROFILE_TTL_SECONDS,
    });
  }

  async listPairedDevices(): Promise<unknown> {
    return this.request<unknown>("/users/me/pairedDevices", {}, {
      operation: "listPairedDevices",
      ttlSeconds: CURRENT_DATA_TTL_SECONDS,
    });
  }

  async updateProfile(body: unknown, updateMask: string): Promise<unknown> {
    const result = await this.request<unknown>(
      `/users/me/profile?updateMask=${encodeURIComponent(updateMask)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    if (this.cacheEnabled) await invalidateHealthCache(this.appUserId);
    return result;
  }

  async rawGet(path: string): Promise<unknown> {
    return this.requestNetwork<unknown>(path, {}, true);
  }

  async rawPatch(path: string, body: unknown): Promise<unknown> {
    return this.requestNetwork<unknown>(
      path,
      { method: "PATCH", body: JSON.stringify(body) },
      false,
    );
  }
}

export type { WriteOp };
