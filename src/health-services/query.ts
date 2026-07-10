import { DateTime } from "luxon";
import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import { GoogleHealthError } from "../google-health/errors";
import { getDataType, type DataTypeSpec } from "../google-health/registry";
import { dailyRollupCivilRange, nowIn, toCivilDateString } from "../time/ranges";
import { DAILY_STALE_AFTER_HOURS, makeFreshness, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, bound, num, str } from "./shape";

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
 * Camel-case a snake filter prefix into the record-payload key the API
 * returns (daily_heart_rate_variability → dailyHeartRateVariability).
 */
function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** "YYYY-MM-DD" from a Google civil Date message ({year, month, day}). */
function civilDateFrom(record: Record<string, unknown>): string | undefined {
  const date = asRec(record.date);
  const year = num(date.year);
  const month = num(date.month);
  const day = num(date.day);
  if (!year || !month || !day) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Best-effort latest-data timestamp across returned points, by record shape:
 * Daily → max civil `date`; Sample → max sample_time.physical_time;
 * Interval/Session → max interval end/start time.
 */
function latestPointTime(dataPoints: unknown[], spec: DataTypeSpec): string | undefined {
  const key = snakeToCamel(spec.snake);
  let best: DateTime | null = null;
  for (const point of dataPoints) {
    const record = asRec(asRec(point)[key]);
    let candidate: string | undefined;
    if (spec.recordType === "Daily") {
      candidate = civilDateFrom(record);
    } else if (spec.recordType === "Sample") {
      candidate = str(asRec(record.sampleTime).physicalTime);
    } else {
      const interval = asRec(record.interval);
      candidate = str(interval.endTime) ?? str(interval.startTime);
    }
    if (!candidate) continue;
    const dt = DateTime.fromISO(candidate);
    if (dt.isValid && (!best || dt > best)) best = dt;
  }
  if (!best) return undefined;
  return spec.recordType === "Daily" ? best.toISODate() ?? undefined : best.toUTC().toISO() ?? undefined;
}

/**
 * Generic escape hatch over any registry data type. If no explicit filter is
 * given, one is derived from startTime by record type (Interval/Session →
 * interval.civil_start_time; Sample → sample_time.physical_time; Daily →
 * civil `date` field — daily aggregates carry NO physical timestamp, so a
 * sample-time filter would silently no-op; Food → no auto-filter, it's a
 * catalog). Filters use the SNAKE name — via the registry, never ad hoc.
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
    } else if (spec.recordType === "Daily") {
      // Daily aggregates key on a civil `date` (live-verified: the date
      // filter constrains in both directions; a physical-time filter would
      // silently return everything). Bare dates pass through; instants are
      // converted to the user's civil date, DST-safely.
      let civilDate = args.startTime;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(civilDate)) {
        const timezone = await getUserTimezone(user, client);
        const dt = DateTime.fromISO(args.startTime, { zone: timezone });
        if (!dt.isValid) {
          throw new GoogleHealthError(
            "invalid_arguments",
            `startTime "${args.startTime}" is not a valid ISO date or instant.`,
          );
        }
        civilDate = dt.toISODate()!;
      }
      filter = `${spec.snake}.date >= "${civilDate}"`;
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
  const latest = latestPointTime(boundedPoints.items, spec);
  return {
    dataType: spec.kebab,
    mode,
    filter,
    dataPoints: boundedPoints.items,
    truncated: boundedPoints.truncated,
    nextPageToken: page.nextPageToken || undefined,
    freshness: makeFreshness(
      latest,
      spec.recordType === "Daily"
        ? "Daily aggregates are computed once per night — a value dated today or yesterday is current."
        : "Raw data points; timestamps are per-point.",
      spec.recordType === "Daily" ? { staleAfterHours: DAILY_STALE_AFTER_HOURS } : undefined,
    ),
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
