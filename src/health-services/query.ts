import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import { GoogleHealthError } from "../google-health/errors";
import { getDataType } from "../google-health/registry";
import { dailyRollupCivilRange, nowIn, toCivilDateString } from "../time/ranges";
import { makeFreshness, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { bound } from "./shape";

export interface QueryResult {
  dataType: string;
  mode: "list" | "reconcile";
  filter?: string;
  dataPoints: unknown[];
  truncated?: string;
  nextPageToken?: string;
  freshness: Freshness;
}

/**
 * Generic escape hatch over any registry data type. If no explicit filter is
 * given, one is derived from startTime by record type (Interval/Session →
 * interval.start_time; Sample → sample_time.physical_time; Daily/Food → no
 * auto-filter). Filters use the SNAKE name — via the registry, never ad hoc.
 */
export async function queryHealthData(
  user: AppUser,
  client: GoogleHealthClient,
  args: {
    dataType: string;
    mode?: "list" | "reconcile";
    filter?: string;
    startTime?: string;
    pageSize?: number;
    pageToken?: string;
  },
): Promise<QueryResult> {
  const spec = getDataType(args.dataType);
  if (!spec) {
    throw new GoogleHealthError(
      "unknown_data_type",
      `Unknown data type "${args.dataType}". Read the health://data-types resource for the allowlist.`,
    );
  }

  let filter = args.filter;
  if (!filter && args.startTime) {
    if (spec.recordType === "Interval" || spec.recordType === "Session") {
      // Interval/Session types accept civil_* filter members (some reject
      // physical start_time — live-verified on nutrition/hydration). Strip
      // any UTC suffix: civil timestamps are naive local time.
      const civil = args.startTime.replace(/(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/, "");
      filter = `${spec.snake}.interval.civil_start_time >= "${civil}"`;
    } else if (spec.recordType === "Sample") {
      filter = `${spec.snake}.sample_time.physical_time >= "${args.startTime}"`;
    }
  }

  const mode = args.mode ?? "list";
  const request = {
    dataType: spec.kebab,
    filter,
    pageSize: args.pageSize,
    pageToken: args.pageToken,
  };
  const page =
    mode === "reconcile"
      ? await client.reconcileDataPoints(request)
      : await client.listDataPoints(request);

  const boundedPoints = bound(page.dataPoints ?? [], 100);
  return {
    dataType: spec.kebab,
    mode,
    filter,
    dataPoints: boundedPoints.items,
    truncated: boundedPoints.truncated,
    nextPageToken: page.nextPageToken || undefined,
    freshness: makeFreshness(undefined, "Raw data points; timestamps are per-point."),
  };
}

export interface RollupResultShaped {
  dataType: string;
  mode: "rollup" | "dailyRollup";
  rollupDataPoints: unknown[];
  truncated?: string;
  freshness: Freshness;
}

export async function rollupHealthData(
  user: AppUser,
  client: GoogleHealthClient,
  args: {
    dataType: string;
    daily?: boolean;
    startTime?: string;
    endTime?: string;
    windowSize?: string;
    startDate?: string;
    endDate?: string;
    windowSizeDays?: number;
    timezone?: string;
  },
): Promise<RollupResultShaped> {
  const spec = getDataType(args.dataType);
  if (!spec) {
    throw new GoogleHealthError(
      "unknown_data_type",
      `Unknown data type "${args.dataType}".`,
    );
  }

  if (args.daily || args.startDate || args.endDate || args.windowSizeDays) {
    const timezone = args.timezone ?? (await getUserTimezone(user, client));
    const today = toCivilDateString(nowIn(timezone));
    const startDate = args.startDate ?? today;
    const endDate = args.endDate ?? today;
    const result = await client.dailyRollUp({
      dataType: spec.kebab,
      range: dailyRollupCivilRange(startDate, endDate, timezone),
      windowSizeDays: args.windowSizeDays ?? 1,
    });
    const boundedPoints = bound(result.rollupDataPoints ?? [], 100);
    return {
      dataType: spec.kebab,
      mode: "dailyRollup",
      rollupDataPoints: boundedPoints.items,
      truncated: boundedPoints.truncated,
      freshness: makeFreshness(),
    };
  }

  if (!args.startTime || !args.endTime) {
    throw new GoogleHealthError(
      "invalid_arguments",
      "Physical rollup requires startTime and endTime (UTC ISO); daily rollup requires daily=true with startDate/endDate.",
    );
  }
  const result = await client.rollUp({
    dataType: spec.kebab,
    range: { startTime: args.startTime, endTime: args.endTime },
    windowSize: args.windowSize ?? "3600s",
  });
  const boundedPoints = bound(result.rollupDataPoints ?? [], 100);
  return {
    dataType: spec.kebab,
    mode: "rollup",
    rollupDataPoints: boundedPoints.items,
    truncated: boundedPoints.truncated,
    freshness: makeFreshness(),
  };
}
