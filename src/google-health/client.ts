import { getValidAccessToken } from "../auth/token-service";
import { getConnection } from "../auth/token-store";
import { redactString } from "../security/redact";
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
import type { CivilRange, PhysicalRange } from "../time/ranges";

/**
 * Central Google Health API client (docs/PLAN.md §"Google Health client",
 * handoff §18/§21). Every tool call goes through here: token resolution,
 * scope prechecks against the granted-scope list, normalized errors, one
 * forced-refresh retry on 401, bounded backoff on 429, pagination.
 */

const API_BASE = "https://health.googleapis.com/v4";
const MAX_PAGE_SIZE = 100; // payload discipline: tools never exceed this
const RATE_LIMIT_RETRIES = 2;

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
  windowSize: string; // e.g. "3600s"
}

export interface DailyRollupArgs {
  dataType: string;
  range: CivilRange;
  windowSizeDays: number;
}

export interface RollupResult {
  rollupDataPoints: unknown[];
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

export class GoogleHealthClient {
  constructor(private readonly appUserId: string) {}

  private grantedScopesCache: string[] | null = null;

  private async grantedScopes(): Promise<string[]> {
    if (this.grantedScopesCache) return this.grantedScopesCache;
    const connection = await getConnection(this.appUserId);
    if (!connection) throw new NotConnectedError();
    this.grantedScopesCache = connection.scopes;
    return connection.scopes;
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

  /**
   * Authenticated request with normalized failure handling:
   * 401 → one forced token refresh + retry; 429 → bounded backoff honoring
   * Retry-After; other non-2xx → GoogleApiError with a redacted message.
   */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let forceRefresh = false;
    let rateLimitAttempt = 0;

    for (;;) {
      const token = await getValidAccessToken(this.appUserId, { forceRefresh });
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });

      if (response.status === 401 && !forceRefresh) {
        forceRefresh = true;
        continue;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 30;
        if (rateLimitAttempt < RATE_LIMIT_RETRIES) {
          rateLimitAttempt += 1;
          await sleep(Math.min(1000 * 2 ** rateLimitAttempt, 4000));
          continue;
        }
        throw new RateLimitedError(retryAfter);
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

  async listDataPoints(args: ListArgs): Promise<DataPointPage> {
    const spec = await this.precheck(args.dataType, "list");
    const params = new URLSearchParams();
    if (args.filter) params.set("filter", args.filter);
    params.set("pageSize", String(Math.min(args.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)));
    if (args.pageToken) params.set("pageToken", args.pageToken);
    return this.request<DataPointPage>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints?${params.toString()}`,
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
    );
  }

  /** `name` is a full resource name: users/{id}/dataTypes/{type}/dataPoints/{id}. */
  async getDataPoint(name: string): Promise<unknown> {
    return this.request<unknown>(`/${name}`);
  }

  async rollUp(args: RollupArgs): Promise<RollupResult> {
    const spec = await this.precheck(args.dataType, "rollup");
    return this.request<RollupResult>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints:rollUp`,
      {
        method: "POST",
        body: JSON.stringify({ range: args.range, windowSize: args.windowSize }),
      },
    );
  }

  async dailyRollUp(args: DailyRollupArgs): Promise<RollupResult> {
    const spec = await this.precheck(args.dataType, "dailyRollup");
    return this.request<RollupResult>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints:dailyRollUp`,
      {
        method: "POST",
        body: JSON.stringify({
          range: args.range,
          windowSizeDays: args.windowSizeDays,
        }),
      },
    );
  }

  async createDataPoint(dataType: string, body: unknown): Promise<unknown> {
    const spec = await this.precheck(dataType, "create");
    return this.request<unknown>(`/users/me/dataTypes/${spec.kebab}/dataPoints`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async patchDataPoint(
    dataType: string,
    name: string,
    body: unknown,
  ): Promise<unknown> {
    await this.precheck(dataType, "update");
    return this.request<unknown>(`/${name}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async batchDeleteDataPoints(dataType: string, names: string[]): Promise<unknown> {
    const spec = await this.precheck(dataType, "batchDelete");
    return this.request<unknown>(
      `/users/me/dataTypes/${spec.kebab}/dataPoints:batchDelete`,
      { method: "POST", body: JSON.stringify({ names }) },
    );
  }

  async getIdentity(): Promise<unknown> {
    return this.request<unknown>("/users/me/identity");
  }

  /**
   * Profile/settings endpoints — path shape to be verified against the live
   * v4 REST reference in Phase 5 before the tools ship (docs/PLAN.md rule:
   * do not invent). getProfile is documented (users/getProfile).
   */
  async getProfile(): Promise<unknown> {
    return this.request<unknown>("/users/me/profile");
  }

  async getSettings(): Promise<unknown> {
    return this.request<unknown>("/users/me/settings");
  }

  /** Paired devices (live-verified 2026-07-09: type, battery, version). */
  async listPairedDevices(): Promise<unknown> {
    return this.request<unknown>("/users/me/pairedDevices");
  }

  /** Diagnostic-only raw GET (scripts/gh-probe.ts). Not for tool code. */
  async rawGet(path: string): Promise<unknown> {
    return this.request<unknown>(path);
  }
}

export type { WriteOp };
