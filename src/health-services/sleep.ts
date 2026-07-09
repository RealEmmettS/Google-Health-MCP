import { DateTime } from "luxon";
import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import { lastNightWindow, nowIn, toCivilDateString } from "../time/ranges";
import { makeFreshness, maxTime, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, bound, num, str } from "./shape";

interface SleepSession {
  startTime?: string;
  endTime?: string;
  isMain: boolean;
  minutesAsleep?: number;
  minutesAwake?: number;
  minutesInSleepPeriod?: number;
  minutesToFallAsleep?: number;
  stagesSummary?: unknown;
  stageSegmentCount?: number;
  stages?: unknown[];
  type?: string;
}

export interface SleepSummary {
  mode: "last_night" | "date";
  date: string;
  timezone: string;
  totalSleepMinutes?: number;
  mainSession?: SleepSession;
  otherSessions: SleepSession[];
  truncated?: string;
  freshness: Freshness;
}

/**
 * "How much did I sleep last night?" — reconciled sleep sessions whose civil
 * END time falls on the reference date (sessions cross midnight; querying by
 * end time catches the one that finished this morning).
 */
export async function getSleepSummary(
  user: AppUser,
  client: GoogleHealthClient,
  args: {
    date?: string;
    timezone?: string;
    mode?: "last_night" | "date";
    includeStages?: boolean;
  },
): Promise<SleepSummary> {
  const timezone = args.timezone ?? (await getUserTimezone(user, client));
  const mode = args.mode ?? (args.date ? "date" : "last_night");
  const date = args.date ?? toCivilDateString(nowIn(timezone));
  const { sinceCivilDate } = lastNightWindow(timezone, date);

  const page = await client.reconcileDataPoints({
    dataType: "sleep",
    filter: `sleep.interval.civil_end_time >= "${sinceCivilDate}"`,
    pageSize: 20,
  });

  const sessions: SleepSession[] = (page.dataPoints ?? [])
    .map((dp) => asRec(asRec(dp).sleep))
    .filter((sleep) => Object.keys(sleep).length > 0)
    .map((sleep) => {
      const interval = asRec(sleep.interval);
      const summary = asRec(sleep.summary);
      const metadata = asRec(sleep.metadata);
      const stages = Array.isArray(sleep.stages) ? sleep.stages : undefined;
      return {
        startTime: str(interval.startTime),
        endTime: str(interval.endTime),
        isMain: metadata.main === true,
        minutesAsleep: num(summary.minutesAsleep),
        minutesAwake: num(summary.minutesAwake),
        minutesInSleepPeriod: num(summary.minutesInSleepPeriod),
        minutesToFallAsleep: num(summary.minutesToFallAsleep),
        stagesSummary: summary.stagesSummary,
        stageSegmentCount: stages?.length,
        stages: args.includeStages ? stages?.slice(0, 80) : undefined,
        type: str(sleep.type),
      };
    })
    // Keep sessions that END on the reference date (in the user's zone).
    .filter((session) => {
      if (!session.endTime) return true;
      const end = DateTime.fromISO(session.endTime).setZone(timezone);
      return end.isValid && end.toISODate() === date;
    })
    .sort((a, b) => (b.minutesInSleepPeriod ?? 0) - (a.minutesInSleepPeriod ?? 0));

  const mainSession = sessions.find((s) => s.isMain) ?? sessions[0];
  const others = bound(
    sessions.filter((s) => s !== mainSession),
    5,
  );

  const latestDataTime = maxTime(...sessions.map((s) => s.endTime));
  const endedRecently =
    mainSession?.endTime &&
    DateTime.utc().diff(DateTime.fromISO(mainSession.endTime), "hours").hours < 2;

  return {
    mode,
    date,
    timezone,
    totalSleepMinutes: mainSession?.minutesAsleep,
    mainSession,
    otherSessions: others.items,
    truncated: others.truncated,
    freshness: makeFreshness(
      latestDataTime,
      endedRecently
        ? "The sleep session ended recently — stage analysis may still be processing."
        : sessions.length === 0
          ? "No sleep session has synced for this date yet — the device may not have synced since waking."
          : undefined,
    ),
  };
}
