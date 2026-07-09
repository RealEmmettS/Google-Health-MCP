import { DateTime, type DateTimeMaybeValid } from "luxon";

/**
 * Time-range helpers (docs/PLAN.md §"Google Health client"). All range math
 * runs in the USER'S timezone (default America/Chicago) via Luxon, then
 * converts to what the API wants:
 * - physical ranges: UTC ISO instants (list filters, rollUp)
 * - civil ranges: {date:{year,month,day}, time:{...}} objects with PLAIN
 *   NUMBERS (dailyRollUp rejects zero-padded values — "Octal/hex numbers are
 *   not valid JSON")
 */

export const DEFAULT_TIMEZONE = "America/Chicago";

export interface PhysicalRange {
  startTime: string; // UTC ISO instant
  endTime: string;
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface CivilDateTime {
  date: CivilDate;
  time: { hours: number; minutes: number; seconds: number };
}

export interface CivilRange {
  start: CivilDateTime;
  end: CivilDateTime;
}

function assertValid(dt: DateTimeMaybeValid, what: string): DateTime {
  if (!dt.isValid) {
    throw new Error(`Invalid ${what}: ${dt.invalidReason ?? "unknown"}`);
  }
  return dt;
}

export function nowIn(timezone: string = DEFAULT_TIMEZONE): DateTime {
  return assertValid(DateTime.now().setZone(timezone), `timezone "${timezone}"`);
}

export function parseCivilDate(
  dateISO: string,
  timezone: string = DEFAULT_TIMEZONE,
): DateTime {
  return assertValid(
    DateTime.fromISO(dateISO, { zone: timezone }),
    `date "${dateISO}"`,
  );
}

export function toUtcIso(dt: DateTime): string {
  const iso = dt.toUTC().toISO({ suppressMilliseconds: true });
  if (!iso) throw new Error("Failed to serialize datetime");
  return iso;
}

export function toCivilDateTime(dt: DateTime): CivilDateTime {
  return {
    date: { year: dt.year, month: dt.month, day: dt.day },
    time: { hours: dt.hour, minutes: dt.minute, seconds: dt.second },
  };
}

export function toCivilDateString(dt: DateTime): string {
  const iso = dt.toISODate();
  if (!iso) throw new Error("Failed to serialize date");
  return iso;
}

/** Physical UTC range covering one civil day in the user's timezone (DST-safe). */
export function dayRange(
  dateISO: string,
  timezone: string = DEFAULT_TIMEZONE,
): PhysicalRange {
  const day = parseCivilDate(dateISO, timezone);
  return {
    startTime: toUtcIso(day.startOf("day")),
    endTime: toUtcIso(day.endOf("day")),
  };
}

/** Start of today (user TZ) → now. The natural range for "steps today". */
export function todayRange(timezone: string = DEFAULT_TIMEZONE): PhysicalRange {
  const now = nowIn(timezone);
  return { startTime: toUtcIso(now.startOf("day")), endTime: toUtcIso(now) };
}

export function yesterdayRange(timezone: string = DEFAULT_TIMEZONE): PhysicalRange {
  const yesterday = nowIn(timezone).minus({ days: 1 });
  return dayRange(toCivilDateString(yesterday), timezone);
}

/** ISO week (Monday) start → now. */
export function currentWeekRange(timezone: string = DEFAULT_TIMEZONE): PhysicalRange {
  const now = nowIn(timezone);
  return { startTime: toUtcIso(now.startOf("week")), endTime: toUtcIso(now) };
}

/**
 * "Last night" for sleep queries. Sleep sessions cross midnight, so the query
 * strategy (docs/PLAN.md) is: reconcile/list sleep whose civil END time falls
 * on or after the reference date — plus a generous physical window for
 * clients that filter physically (yesterday 12:00 → reference 23:59).
 */
export function lastNightWindow(
  timezone: string = DEFAULT_TIMEZONE,
  referenceDateISO?: string,
): { sinceCivilDate: string; physical: PhysicalRange } {
  const reference = referenceDateISO
    ? parseCivilDate(referenceDateISO, timezone)
    : nowIn(timezone);
  return {
    sinceCivilDate: toCivilDateString(reference),
    physical: {
      startTime: toUtcIso(reference.minus({ days: 1 }).set({ hour: 12 }).startOf("hour")),
      endTime: toUtcIso(reference.endOf("day")),
    },
  };
}

/** Civil closed range for dailyRollUp (docs example: 00:00:00 → 23:59:59). */
export function dailyRollupCivilRange(
  startDateISO: string,
  endDateISO: string,
  timezone: string = DEFAULT_TIMEZONE,
): CivilRange {
  const start = parseCivilDate(startDateISO, timezone).startOf("day");
  const end = parseCivilDate(endDateISO, timezone).endOf("day").startOf("second");
  return { start: toCivilDateTime(start), end: toCivilDateTime(end) };
}
