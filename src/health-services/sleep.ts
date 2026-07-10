import { DateTime } from "luxon";
import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import { lastNightWindow, nowIn, toCivilDateString } from "../time/ranges";
import { DAILY_STALE_AFTER_HOURS, makeFreshness, maxTime, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, bound, num, str } from "./shape";

interface SleepSession {
  startTime?: string;
  endTime?: string;
  /** Google's own main-session flag, when the record carries one. */
  googleMarkedMain?: boolean;
  minutesAsleep?: number;
  minutesAwake?: number;
  minutesInSleepPeriod?: number;
  minutesToFallAsleep?: number;
  stagesSummary?: unknown;
  stageSegmentCount?: number;
  stages?: unknown[];
  type?: string;
  /** e.g. REJECTED_COVERAGE — Google's reason when a night lacks stages. */
  stagesStatus?: string;
}

/**
 * Google's raw stagesSummary can contain exact-duplicate rows (live-observed
 * on CLASSIC sessions: the same ASLEEP row twice). Dedupe so downstream sums
 * don't double-count minutes; genuinely distinct rows always survive.
 */
function dedupeStagesSummary(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  return value.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
        googleMarkedMain: typeof metadata.main === "boolean" ? metadata.main : undefined,
        minutesAsleep: num(summary.minutesAsleep),
        minutesAwake: num(summary.minutesAwake),
        minutesInSleepPeriod: num(summary.minutesInSleepPeriod),
        minutesToFallAsleep: num(summary.minutesToFallAsleep),
        stagesSummary: dedupeStagesSummary(summary.stagesSummary),
        stageSegmentCount: stages?.length,
        stages: args.includeStages ? stages?.slice(0, 80) : undefined,
        type: str(sleep.type),
        stagesStatus: str(metadata.stagesStatus),
      };
    })
    // Keep sessions that END on the reference date (in the user's zone).
    .filter((session) => {
      if (!session.endTime) return true;
      const end = DateTime.fromISO(session.endTime).setZone(timezone);
      return end.isValid && end.toISODate() === date;
    })
    .sort((a, b) => (b.minutesInSleepPeriod ?? 0) - (a.minutesInSleepPeriod ?? 0));

  // Main = Google's flag when present, else the longest session (sessions are
  // sorted by minutesInSleepPeriod desc above).
  const mainSession = sessions.find((s) => s.googleMarkedMain) ?? sessions[0];
  const others = bound(
    sessions.filter((s) => s !== mainSession),
    5,
  );

  const latestDataTime = maxTime(...sessions.map((s) => s.endTime));
  const endedRecently =
    mainSession?.endTime &&
    DateTime.utc().diff(DateTime.fromISO(mainSession.endTime), "hours").hours < 2;

  const notes: string[] = [];
  if (endedRecently) {
    notes.push("The sleep session ended recently — stage analysis may still be processing.");
  } else if (sessions.length === 0) {
    notes.push(
      "No sleep session has synced for this date yet — the device may not have synced since waking.",
    );
  }
  if (mainSession?.type === "CLASSIC") {
    notes.push(
      `This is a CLASSIC session — the device recorded a single asleep/awake block instead of deep/light/REM stages${
        mainSession.stagesStatus ? ` (stagesStatus: ${mainSession.stagesStatus})` : ""
      }. That reflects capture conditions (short session, loose band, or HR signal gaps), not sleep quality.`,
    );
  }

  return {
    mode,
    date,
    timezone,
    totalSleepMinutes: mainSession?.minutesAsleep,
    mainSession,
    otherSessions: others.items,
    truncated: others.truncated,
    // Sleep is a once-per-night record: this morning's session must not read
    // as stale by the evening — only a missed day should flag.
    freshness: makeFreshness(latestDataTime, notes.join(" ") || undefined, {
      staleAfterHours: DAILY_STALE_AFTER_HOURS,
    }),
  };
}
