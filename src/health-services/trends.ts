import { DateTime } from "luxon";
import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import { GoogleHealthError } from "../google-health/errors";
import { getDataType } from "../google-health/registry";
import { dailyRollupCivilRange, nowIn, toCivilDateString } from "../time/ranges";
import {
  DAILY_STALE_AFTER_HOURS,
  makeFreshness,
  maxTime,
  type Freshness,
} from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, num, pickNum, str } from "./shape";

export const TREND_METRICS = [
  "steps",
  "sleep-minutes",
  "resting-heart-rate",
  "heart-rate-variability",
  "oxygen-saturation",
  "respiratory-rate",
  "exercise-sessions",
  "hydration",
  "nutrition-calories",
] as const;

export type TrendMetric = (typeof TREND_METRICS)[number];

interface TrendPoint {
  date: string;
  value: number | null;
  status: "recorded" | "missing";
}

export interface MetricTrend {
  metric: TrendMetric;
  unit: string;
  points: TrendPoint[];
  summary: {
    recordedDays: number;
    missingDays: number;
    average?: number;
    minimum?: number;
    maximum?: number;
    firstRecorded?: number;
    latestRecorded?: number;
  };
  note?: string;
  error?: { code: string; note: string };
}

export interface HealthTrends {
  days: 7 | 30 | 90;
  startDate: string;
  endDate: string;
  timezone: string;
  metrics: MetricTrend[];
  freshness: Freshness;
  note: string;
}

interface MetricSpec {
  unit: string;
  dataType: string;
  mode: "daily" | "rollup" | "session";
  valueKeys: string[];
  sessionDate: "start" | "end";
}

const SPECS: Record<TrendMetric, MetricSpec> = {
  steps: {
    unit: "count",
    dataType: "steps",
    mode: "rollup",
    valueKeys: ["countSum", "steps"],
    sessionDate: "start",
  },
  "sleep-minutes": {
    unit: "minutes",
    dataType: "sleep",
    mode: "session",
    valueKeys: ["minutesAsleep"],
    sessionDate: "end",
  },
  "resting-heart-rate": {
    unit: "beats/min",
    dataType: "daily-resting-heart-rate",
    mode: "daily",
    valueKeys: ["beatsPerMinute", "restingHeartRate", "bpm", "value"],
    sessionDate: "start",
  },
  "heart-rate-variability": {
    unit: "ms",
    dataType: "daily-heart-rate-variability",
    mode: "daily",
    valueKeys: [
      "averageHeartRateVariabilityMilliseconds",
      "heartRateVariabilityMilliseconds",
      "rmssdMilliseconds",
      "value",
    ],
    sessionDate: "start",
  },
  "oxygen-saturation": {
    unit: "%",
    dataType: "daily-oxygen-saturation",
    mode: "daily",
    valueKeys: [
      "averageOxygenSaturationPercentage",
      "oxygenSaturationPercentage",
      "averagePercentage",
      "average",
      "value",
    ],
    sessionDate: "start",
  },
  "respiratory-rate": {
    unit: "breaths/min",
    dataType: "daily-respiratory-rate",
    mode: "daily",
    valueKeys: [
      "averageRespiratoryRateBreathsPerMinute",
      "respiratoryRateBreathsPerMinute",
      "breathsPerMinute",
      "average",
      "value",
    ],
    sessionDate: "start",
  },
  "exercise-sessions": {
    unit: "sessions",
    dataType: "exercise",
    mode: "session",
    valueKeys: [],
    sessionDate: "start",
  },
  hydration: {
    unit: "mL logged",
    dataType: "hydration-log",
    mode: "session",
    valueKeys: ["milliliters", "value", "quantity"],
    sessionDate: "start",
  },
  "nutrition-calories": {
    unit: "kcal logged",
    dataType: "nutrition-log",
    mode: "session",
    valueKeys: ["caloriesKcal", "kilocalories", "quantity", "value"],
    sessionDate: "start",
  },
};

function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function civilDate(value: unknown): string | undefined {
  const record = asRec(value);
  const year = num(record.year);
  const month = num(record.month);
  const day = num(record.day);
  if (!year || !month || !day) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateForRecord(
  record: Record<string, unknown>,
  timezone: string,
  edge: "start" | "end",
): string | undefined {
  const date =
    civilDate(record.date) ??
    civilDate(asRec(record.civilStartTime).date) ??
    civilDate(asRec(record.civilEndTime).date);
  if (date) return date;
  const interval = asRec(record.interval);
  const timestamp =
    str(interval[`${edge}Time`]) ??
    str(record[`${edge}Time`]) ??
    str(asRec(record.sampleTime).physicalTime);
  if (!timestamp) return undefined;
  const parsed = DateTime.fromISO(timestamp).setZone(timezone);
  return parsed.isValid ? parsed.toISODate() ?? undefined : undefined;
}

function deepNumber(value: unknown, keys: string[], depth = 0): number | undefined {
  if (depth > 5) return undefined;
  const record = asRec(value);
  const direct = pickNum(record, keys);
  if (direct !== undefined) return direct;
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const found = deepNumber(nested, keys, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = DateTime.fromISO(startDate);
  const end = DateTime.fromISO(endDate);
  while (cursor <= end) {
    dates.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

function finishTrend(
  metric: TrendMetric,
  values: Map<string, number>,
  dates: string[],
  note?: string,
): MetricTrend {
  const recorded = dates
    .map((date) => values.get(date))
    .filter((value): value is number => value !== undefined);
  const points: TrendPoint[] = dates.map((date) => {
    const value = values.get(date);
    return value === undefined
      ? { date, value: null, status: "missing" }
      : { date, value, status: "recorded" };
  });
  return {
    metric,
    unit: SPECS[metric].unit,
    points,
    summary: {
      recordedDays: recorded.length,
      missingDays: dates.length - recorded.length,
      average: recorded.length
        ? recorded.reduce((sum, value) => sum + value, 0) / recorded.length
        : undefined,
      minimum: recorded.length ? Math.min(...recorded) : undefined,
      maximum: recorded.length ? Math.max(...recorded) : undefined,
      firstRecorded: recorded[0],
      latestRecorded: recorded.at(-1),
    },
    note,
  };
}

async function allPoints(
  client: GoogleHealthClient,
  dataType: string,
  filter: string,
): Promise<unknown[]> {
  const points: unknown[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const result = await client.reconcileDataPoints({
      dataType,
      filter,
      pageSize: 100,
      pageToken,
    });
    points.push(...(result.dataPoints ?? []));
    pageToken = result.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return points.slice(0, 500);
}

async function loadMetric(
  client: GoogleHealthClient,
  metric: TrendMetric,
  startDate: string,
  endDate: string,
  timezone: string,
  dates: string[],
): Promise<MetricTrend> {
  const spec = SPECS[metric];
  const typeSpec = getDataType(spec.dataType)!;
  const values = new Map<string, number>();

  if (spec.mode === "rollup") {
    const response = await client.dailyRollUp({
      dataType: spec.dataType,
      range: dailyRollupCivilRange(startDate, endDate, timezone),
      windowSizeDays: 1,
    });
    for (const point of response.rollupDataPoints ?? []) {
      const record = asRec(point);
      const value = deepNumber(record[typeSpec.kebab] ?? record, spec.valueKeys);
      const date = dateForRecord(record, timezone, "start");
      if (date && value !== undefined) values.set(date, value);
    }
    return finishTrend(metric, values, dates, "A zero bucket is retained; a missing bucket stays missing.");
  }

  const edge = spec.sessionDate;
  const filter =
    typeSpec.recordType === "Daily"
      ? `${typeSpec.snake}.date >= "${startDate}"`
      : `${typeSpec.snake}.interval.civil_${edge}_time >= "${startDate}T00:00:00"`;
  const points = await allPoints(client, spec.dataType, filter);
  const dailyCandidates = new Map<string, number[]>();

  for (const point of points) {
    const outer = asRec(point);
    const record = asRec(outer[snakeToCamel(typeSpec.snake)] ?? point);
    const date = dateForRecord(record, timezone, edge);
    if (!date || date < startDate || date > endDate) continue;

    let value: number | undefined;
    if (metric === "exercise-sessions") {
      value = 1;
    } else if (metric === "hydration") {
      const volume = asRec(record.volume);
      const raw = pickNum(volume, ["value", "quantity"]);
      const unit = str(volume.unit);
      value = raw === undefined ? undefined : unit === "LITER" ? raw * 1000 : raw;
    } else if (metric === "nutrition-calories") {
      value = deepNumber(record.energy ?? record, spec.valueKeys);
    } else {
      value = deepNumber(record, spec.valueKeys);
    }
    if (value === undefined) continue;
    dailyCandidates.set(date, [...(dailyCandidates.get(date) ?? []), value]);
  }

  for (const [date, candidates] of dailyCandidates) {
    if (metric === "sleep-minutes") {
      // A main sleep session should not be double-counted with naps/duplicates.
      values.set(date, Math.max(...candidates));
    } else {
      values.set(date, candidates.reduce((sum, value) => sum + value, 0));
    }
  }

  const note =
    metric === "hydration" || metric === "nutrition-calories"
      ? "Values reflect logged entries only; missing data is not zero consumption."
      : metric === "sleep-minutes"
        ? "Uses the longest synced sleep session ending on each date."
        : undefined;
  return finishTrend(metric, values, dates, note);
}

export async function getHealthTrends(
  user: AppUser,
  client: GoogleHealthClient,
  args: {
    days: 7 | 30 | 90;
    metrics?: TrendMetric[];
    timezone?: string;
  },
): Promise<HealthTrends> {
  const timezone = args.timezone ?? (await getUserTimezone(user, client));
  const endDate = toCivilDateString(nowIn(timezone));
  const startDate = toCivilDateString(
    DateTime.fromISO(endDate, { zone: timezone }).minus({ days: args.days - 1 }),
  );
  const dates = datesBetween(startDate, endDate);
  const requested = [...new Set(args.metrics?.length ? args.metrics : TREND_METRICS)];

  const settled = await Promise.allSettled(
    requested.map((metric) =>
      loadMetric(client, metric, startDate, endDate, timezone, dates),
    ),
  );
  const metrics = settled.map((result, index): MetricTrend => {
    if (result.status === "fulfilled") return result.value;
    const error = result.reason;
    return {
      metric: requested[index],
      unit: SPECS[requested[index]].unit,
      points: dates.map((date) => ({ date, value: null, status: "missing" })),
      summary: { recordedDays: 0, missingDays: dates.length },
      error: {
        code: error instanceof GoogleHealthError ? error.code : "metric_unavailable",
        note: "This metric could not be retrieved. Other metrics remain usable.",
      },
    };
  });

  const latestRecordedDate = maxTime(
    ...metrics.flatMap((metric) =>
      metric.points
        .filter((point) => point.status === "recorded")
        .map((point) => point.date),
    ),
  );

  return {
    days: args.days,
    startDate,
    endDate,
    timezone,
    metrics,
    freshness: makeFreshness(
      latestRecordedDate,
      "Trend gaps remain explicit and are never converted to zero.",
      { staleAfterHours: DAILY_STALE_AFTER_HOURS },
    ),
    note:
      "These are bounded synced-data summaries, not medical interpretation. Compare recording coverage before interpreting changes.",
  };
}

export const _internal = {
  civilDate,
  dateForRecord,
  deepNumber,
  datesBetween,
  finishTrend,
};
