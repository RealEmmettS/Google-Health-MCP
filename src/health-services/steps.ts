import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import {
  dailyRollupCivilRange,
  dayRange,
  nowIn,
  toCivilDateString,
  todayRange,
} from "../time/ranges";
import { makeFreshness, maxTime, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, num, str } from "./shape";

export interface TodaySteps {
  date: string;
  timezone: string;
  steps: number;
  goalSteps?: number;
  remainingToGoal?: number;
  goalNote?: string;
  hourly: Array<{ startTime?: string; endTime?: string; steps: number }>;
  freshness: Freshness;
}

/**
 * "How many steps do I have today?" — dailyRollUp for the civil-day total
 * plus an hourly rollUp whose latest non-empty bucket doubles as the
 * synced-through signal. NOTE: the v4 API exposes no step goal; a goal is
 * only reported when the caller supplies one (never invented).
 */
export async function getTodaySteps(
  user: AppUser,
  client: GoogleHealthClient,
  args: { date?: string; timezone?: string; goalSteps?: number },
): Promise<TodaySteps> {
  const timezone = args.timezone ?? (await getUserTimezone(user, client));
  const today = toCivilDateString(nowIn(timezone));
  const date = args.date ?? today;

  const physicalRange = date === today ? todayRange(timezone) : dayRange(date, timezone);
  const [daily, hourlyResult] = await Promise.all([
    client.dailyRollUp({
      dataType: "steps",
      range: dailyRollupCivilRange(date, date, timezone),
      windowSizeDays: 1,
    }),
    client.rollUp({
      dataType: "steps",
      range: physicalRange,
      windowSize: "3600s",
    }),
  ]);
  const steps =
    num(asRec(asRec(daily.rollupDataPoints?.[0]).steps).countSum) ?? 0;

  const hourly = (hourlyResult.rollupDataPoints ?? [])
    .map((point) => {
      const record = asRec(point);
      return {
        startTime: str(record.startTime),
        endTime: str(record.endTime),
        steps: num(asRec(record.steps).countSum) ?? 0,
      };
    })
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  const latestDataTime = maxTime(...hourly.map((b) => b.endTime));

  return {
    date,
    timezone,
    steps,
    goalSteps: args.goalSteps,
    remainingToGoal:
      args.goalSteps !== undefined ? Math.max(0, args.goalSteps - steps) : undefined,
    goalNote:
      args.goalSteps === undefined
        ? "The Google Health API does not expose step goals; pass goalSteps if the user's goal is known. Do not invent a goal."
        : undefined,
    hourly,
    freshness: makeFreshness(
      latestDataTime,
      "A zero-step hour may mean the tracker was off-wrist or unsynced, not inactivity.",
    ),
  };
}
