import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  dailyRollupCivilRange,
  dayRange,
  DEFAULT_TIMEZONE,
  lastNightWindow,
  currentWeekRange,
  todayRange,
} from "../../src/time/ranges";

const hoursBetween = (range: { startTime: string; endTime: string }) =>
  DateTime.fromISO(range.endTime).diff(DateTime.fromISO(range.startTime), "hours").hours;

describe("ranges (America/Chicago default)", () => {
  it("defaults to America/Chicago", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Chicago");
  });

  it("dayRange covers a normal 24h civil day", () => {
    const range = dayRange("2026-07-01");
    // CDT is UTC-5 in July.
    expect(range.startTime).toBe("2026-07-01T05:00:00Z");
    expect(Math.round(hoursBetween(range))).toBe(24);
  });

  it("handles the 23-hour spring-forward day (2026-03-08)", () => {
    const range = dayRange("2026-03-08");
    expect(Math.round(hoursBetween(range))).toBe(23);
  });

  it("handles the 25-hour fall-back day (2026-11-01)", () => {
    const range = dayRange("2026-11-01");
    expect(Math.round(hoursBetween(range))).toBe(25);
  });

  it("respects an explicit timezone", () => {
    const range = dayRange("2026-07-01", "Asia/Tokyo"); // UTC+9, no DST
    expect(range.startTime).toBe("2026-06-30T15:00:00Z");
  });

  it("todayRange runs from local start-of-day to now", () => {
    const range = todayRange();
    expect(DateTime.fromISO(range.startTime) <= DateTime.fromISO(range.endTime)).toBe(
      true,
    );
    expect(hoursBetween(range)).toBeLessThanOrEqual(25);
  });

  it("currentWeekRange starts on Monday in the user's zone", () => {
    const range = currentWeekRange();
    const start = DateTime.fromISO(range.startTime).setZone(DEFAULT_TIMEZONE);
    expect(start.weekday).toBe(1);
    expect(start.hour).toBe(0);
  });
});

describe("dailyRollupCivilRange", () => {
  it("emits plain unpadded numbers (API rejects leading zeros)", () => {
    const range = dailyRollupCivilRange("2026-07-09", "2026-07-09");
    expect(range.start.date).toEqual({ year: 2026, month: 7, day: 9 });
    expect(range.start.time).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(range.end.time).toEqual({ hours: 23, minutes: 59, seconds: 59 });
    const serialized = JSON.stringify(range);
    expect(serialized).toContain('"month":7');
    expect(serialized).not.toContain('"07"');
  });
});

describe("lastNightWindow", () => {
  it("anchors the civil date to the reference day and spans yesterday noon onward", () => {
    const window = lastNightWindow(DEFAULT_TIMEZONE, "2026-07-09");
    expect(window.sinceCivilDate).toBe("2026-07-09");
    const start = DateTime.fromISO(window.physical.startTime).setZone(DEFAULT_TIMEZONE);
    expect(start.toISODate()).toBe("2026-07-08");
    expect(start.hour).toBe(12);
  });
});
