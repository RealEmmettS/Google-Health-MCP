import { DateTime } from "luxon";
import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import { nowIn, toCivilDateString } from "../time/ranges";
import { makeFreshness, maxTime, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, bound, pickNum, str } from "./shape";

export interface LatestHeartRate {
  latest?: {
    beatsPerMinute?: number;
    time?: string;
    sample: unknown; // raw sample object so the LLM sees actual fields
  };
  lookbackMinutes: number;
  restingHeartRate?: { value?: number; raw?: unknown };
  context?: {
    recentExercise: unknown[];
    lastNightSleepMinutes?: number;
    truncated?: string;
  };
  freshness: Freshness;
}

const BPM_KEYS = ["beatsPerMinute", "bpm", "value", "heartRateBpm"];

/**
 * "Why is my heart rate so high?" — the LATEST SYNCED sample (never framed as
 * live), widening the search window until samples appear, plus optional
 * context (recent exercise, last night's sleep, resting-HR baseline).
 * Returns data only; interpretation is the LLM's job.
 */
export async function getLatestHeartRate(
  user: AppUser,
  client: GoogleHealthClient,
  args: { lookbackMinutes?: number; includeContext?: boolean },
): Promise<LatestHeartRate> {
  const lookback = Math.min(Math.max(args.lookbackMinutes ?? 180, 5), 24 * 60);
  const windows = [...new Set([Math.min(30, lookback), lookback])];

  let best: { time: DateTime; sample: unknown } | null = null;
  for (const windowMinutes of windows) {
    const since = DateTime.utc().minus({ minutes: windowMinutes }).toISO({
      suppressMilliseconds: true,
    });
    let pageToken: string | undefined;
    for (let pageCount = 0; pageCount < 3; pageCount++) {
      const page = await client.listDataPoints({
        dataType: "heart-rate",
        filter: `heart_rate.sample_time.physical_time >= "${since}"`,
        pageSize: 100,
        pageToken,
      });
      for (const dp of page.dataPoints ?? []) {
        const heartRate = asRec(asRec(dp).heartRate);
        const timeStr = str(asRec(heartRate.sampleTime).physicalTime);
        if (!timeStr) continue;
        const time = DateTime.fromISO(timeStr);
        if (time.isValid && (!best || time > best.time)) {
          best = { time, sample: heartRate };
        }
      }
      pageToken = page.nextPageToken || undefined;
      if (!pageToken) break;
    }
    if (best) break;
  }

  let restingHeartRate: LatestHeartRate["restingHeartRate"];
  try {
    const resting = await client.listDataPoints({
      dataType: "daily-resting-heart-rate",
      pageSize: 7,
    });
    const latestResting = asRec(
      asRec(resting.dataPoints?.[0]).dailyRestingHeartRate ??
        asRec(resting.dataPoints?.[0]),
    );
    restingHeartRate = {
      value: pickNum(latestResting, [...BPM_KEYS, "restingHeartRate"]),
      raw: resting.dataPoints?.[0],
    };
  } catch {
    restingHeartRate = undefined; // resting HR is best-effort context
  }

  let context: LatestHeartRate["context"];
  if (args.includeContext) {
    const timezone = await getUserTimezone(user, client);
    const yesterday = toCivilDateString(nowIn(timezone).minus({ days: 1 }));
    const exercisePage = await client.listDataPoints({
      dataType: "exercise",
      filter: `exercise.interval.civil_start_time >= "${yesterday}T00:00:00"`,
      pageSize: 10,
    });
    const sessions = (exercisePage.dataPoints ?? []).map((dp) => {
      const exercise = asRec(asRec(dp).exercise);
      return {
        displayName: str(exercise.displayName),
        exerciseType: str(exercise.exerciseType),
        startTime: str(asRec(exercise.interval).startTime),
        endTime: str(asRec(exercise.interval).endTime),
        activeDuration: str(exercise.activeDuration),
        averageHeartRateBeatsPerMinute: pickNum(asRec(exercise.metricsSummary), [
          "averageHeartRateBeatsPerMinute",
        ]),
      };
    });
    const boundedSessions = bound(sessions, 5);

    let lastNightSleepMinutes: number | undefined;
    try {
      const { getSleepSummary } = await import("./sleep");
      const sleep = await getSleepSummary(user, client, { timezone });
      lastNightSleepMinutes = sleep.totalSleepMinutes;
    } catch {
      lastNightSleepMinutes = undefined;
    }

    context = {
      recentExercise: boundedSessions.items,
      truncated: boundedSessions.truncated,
      lastNightSleepMinutes,
    };
  }

  return {
    latest: best
      ? {
          beatsPerMinute: pickNum(best.sample, BPM_KEYS),
          time: best.time.toUTC().toISO() ?? undefined,
          sample: best.sample,
        }
      : undefined,
    lookbackMinutes: lookback,
    restingHeartRate,
    context,
    freshness: makeFreshness(
      maxTime(best?.time.toISO()),
      best
        ? "This is the latest SYNCED sample, not a live reading. It cannot support medical conclusions."
        : "No heart-rate samples found in the lookback window — the tracker may not have synced recently.",
    ),
  };
}
