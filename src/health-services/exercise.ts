import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import {
  dailyRollupCivilRange,
  nowIn,
  parseCivilDate,
  toCivilDateString,
} from "../time/ranges";
import { makeFreshness, maxTime, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, bound, num, pickNum, str } from "./shape";

export interface ExerciseWeek {
  weekStart: string;
  through: string;
  timezone: string;
  sessionCount: number;
  sessions: unknown[];
  truncated?: string;
  totals: {
    caloriesKcal?: number;
    distanceMeters?: number;
    steps?: number;
  };
  activeZoneMinutesDaily: unknown[];
  activeMinutesDaily: unknown[];
  freshness: Freshness;
}

/**
 * "What's my exercise looking like this week?" — logged exercise sessions
 * since the week start (ISO Monday in the user's zone) plus daily
 * active-zone-minutes and active-minutes rollups.
 */
export async function getExerciseWeek(
  user: AppUser,
  client: GoogleHealthClient,
  args: { weekStartDate?: string; timezone?: string },
): Promise<ExerciseWeek> {
  const timezone = args.timezone ?? (await getUserTimezone(user, client));
  const now = nowIn(timezone);
  const weekStart = args.weekStartDate
    ? toCivilDateString(parseCivilDate(args.weekStartDate, timezone).startOf("week"))
    : toCivilDateString(now.startOf("week"));
  const today = toCivilDateString(now);

  async function dailyBuckets(dataType: string): Promise<unknown[]> {
    try {
      const rollup = await client.dailyRollUp({
        dataType,
        range: dailyRollupCivilRange(weekStart, today, timezone),
        windowSizeDays: 1,
      });
      return (rollup.rollupDataPoints ?? []).slice(0, 8);
    } catch {
      return [];
    }
  }

  const [page, activeZoneMinutesDaily, activeMinutesDaily] = await Promise.all([
    client.listDataPoints({
      dataType: "exercise",
      filter: `exercise.interval.civil_start_time >= "${weekStart}T00:00:00"`,
      pageSize: 50,
    }),
    dailyBuckets("active-zone-minutes"),
    dailyBuckets("active-minutes"),
  ]);

  const sessions = (page.dataPoints ?? []).map((dp) => {
    const exercise = asRec(asRec(dp).exercise);
    const interval = asRec(exercise.interval);
    const metrics = asRec(exercise.metricsSummary);
    // "distanceMillimiters" is the API's actual (misspelled) field name.
    const distanceMm =
      pickNum(metrics, ["distanceMillimiters", "distanceMillimeters"]) ?? undefined;
    return {
      name: str(asRec(dp).name),
      displayName: str(exercise.displayName),
      exerciseType: str(exercise.exerciseType),
      startTime: str(interval.startTime),
      endTime: str(interval.endTime),
      activeDuration: str(exercise.activeDuration),
      caloriesKcal: pickNum(metrics, ["caloriesKcal"]),
      distanceMeters: distanceMm !== undefined ? distanceMm / 1000 : undefined,
      steps: pickNum(metrics, ["steps"]),
      averageHeartRateBeatsPerMinute: pickNum(metrics, [
        "averageHeartRateBeatsPerMinute",
      ]),
      activeZoneMinutes: pickNum(metrics, ["activeZoneMinutes"]),
      recordingMethod: str(asRec(asRec(dp).dataSource).recordingMethod),
    };
  });
  const boundedSessions = bound(sessions, 25);

  const sum = (values: Array<number | undefined>) => {
    const present = values.filter((v): v is number => v !== undefined);
    return present.length ? present.reduce((a, b) => a + b, 0) : undefined;
  };

  return {
    weekStart,
    through: today,
    timezone,
    sessionCount: sessions.length,
    sessions: boundedSessions.items,
    truncated: boundedSessions.truncated,
    totals: {
      caloriesKcal: sum(sessions.map((s) => s.caloriesKcal)),
      distanceMeters: sum(sessions.map((s) => s.distanceMeters)),
      steps: sum(sessions.map((s) => s.steps)),
    },
    activeZoneMinutesDaily,
    activeMinutesDaily,
    freshness: makeFreshness(
      maxTime(...sessions.map((s) => s.endTime)),
      sessions.length === 0
        ? "No logged exercise sessions synced for this week yet."
        : undefined,
    ),
  };
}
