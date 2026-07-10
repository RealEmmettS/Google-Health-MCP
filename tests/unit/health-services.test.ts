import { describe, expect, it, vi } from "vitest";
import type { AppUser } from "../../src/auth/app-user";
import type { GoogleHealthClient } from "../../src/google-health/client";
import { DAILY_STALE_AFTER_HOURS, makeFreshness } from "../../src/health-services/freshness";
import { queryHealthData } from "../../src/health-services/query";
import { getSleepSummary } from "../../src/health-services/sleep";

vi.mock("../../src/health-services/profile", () => ({
  getUserTimezone: async () => "America/Chicago",
}));

const user = { id: "test-user" } as AppUser;

function fakeClient(response: { dataPoints?: unknown[]; nextPageToken?: string }) {
  const calls: Array<Record<string, unknown>> = [];
  const handler = async (request: Record<string, unknown>) => {
    calls.push(request);
    return response;
  };
  return {
    calls,
    client: {
      listDataPoints: handler,
      reconcileDataPoints: handler,
    } as unknown as GoogleHealthClient,
  };
}

/** The raw CLASSIC sleep record observed live 2026-07-09 (duplicate
 *  stagesSummary row and stagesStatus straight from Google). */
const CLASSIC_SLEEP_POINT = {
  dataPointName: "users/x/dataTypes/sleep/dataPoints/1",
  sleep: {
    interval: {
      startTime: "2026-07-09T08:05:00Z",
      endTime: "2026-07-09T13:38:00Z",
    },
    type: "CLASSIC",
    stages: [
      {
        startTime: "2026-07-09T08:05:00Z",
        endTime: "2026-07-09T13:38:00Z",
        type: "ASLEEP",
      },
    ],
    metadata: { stagesStatus: "REJECTED_COVERAGE", processed: true },
    summary: {
      minutesInSleepPeriod: "333",
      minutesAsleep: "333",
      minutesAwake: "0",
      minutesToFallAsleep: "0",
      stagesSummary: [
        { type: "ASLEEP", minutes: "333", count: "1" },
        { type: "ASLEEP", minutes: "333", count: "1" },
      ],
    },
  },
};

describe("queryHealthData filter derivation", () => {
  it("builds a civil-date filter for Daily types (the sample-time filter would silently no-op)", async () => {
    const { calls, client } = fakeClient({ dataPoints: [] });
    const result = await queryHealthData(user, client, {
      dataType: "daily-heart-rate-variability",
      startTime: "2026-07-05",
    });
    expect(result.filter).toBe('daily_heart_rate_variability.date >= "2026-07-05"');
    expect(calls[0].filter).toBe(result.filter);
  });

  it("converts an ISO instant to the user's civil date for Daily types", async () => {
    const { client } = fakeClient({ dataPoints: [] });
    // 2026-07-06T02:00Z is still 2026-07-05 in America/Chicago (UTC-5).
    const result = await queryHealthData(user, client, {
      dataType: "daily-resting-heart-rate",
      startTime: "2026-07-06T02:00:00Z",
    });
    expect(result.filter).toBe('daily_resting_heart_rate.date >= "2026-07-05"');
  });

  it("keeps the sample-time filter for Sample types", async () => {
    const { client } = fakeClient({ dataPoints: [] });
    const result = await queryHealthData(user, client, {
      dataType: "heart-rate",
      startTime: "2026-07-05T00:00:00Z",
    });
    expect(result.filter).toBe(
      'heart_rate.sample_time.physical_time >= "2026-07-05T00:00:00Z"',
    );
  });

  it("derives daily freshness from the civil date field with the daily threshold", async () => {
    const now = new Date();
    const { client } = fakeClient({
      dataPoints: [
        {
          dailyHeartRateVariability: {
            date: {
              year: now.getUTCFullYear(),
              month: now.getUTCMonth() + 1,
              day: now.getUTCDate(),
            },
            averageHeartRateVariabilityMilliseconds: 20,
          },
        },
      ],
    });
    const result = await queryHealthData(user, client, {
      dataType: "daily-heart-rate-variability",
      startTime: "2026-01-01",
    });
    expect(result.freshness.latestDataTime).toBeTruthy();
    expect(result.freshness.isPossiblyStale).toBe(false);
    expect(result.freshness.note).toContain("computed once per night");
  });
});

describe("getSleepSummary CLASSIC handling", () => {
  it("dedupes Google's duplicate stagesSummary rows and surfaces stagesStatus", async () => {
    const { client } = fakeClient({ dataPoints: [CLASSIC_SLEEP_POINT] });
    const summary = await getSleepSummary(user, client, {
      date: "2026-07-09",
      timezone: "America/Chicago",
    });
    expect(summary.totalSleepMinutes).toBe(333);
    expect(summary.mainSession?.stagesSummary).toEqual([
      { type: "ASLEEP", minutes: "333", count: "1" },
    ]);
    expect(summary.mainSession?.stagesStatus).toBe("REJECTED_COVERAGE");
    // No false "isMain" claim: Google didn't flag main; we picked the longest.
    expect(summary.mainSession?.googleMarkedMain).toBeUndefined();
    expect(summary.freshness.note).toContain("CLASSIC");
    expect(summary.freshness.note).toContain("REJECTED_COVERAGE");
  });

  it("keeps genuinely distinct stage rows (STAGES sessions)", async () => {
    const stagesPoint = structuredClone(CLASSIC_SLEEP_POINT) as typeof CLASSIC_SLEEP_POINT;
    stagesPoint.sleep.type = "STAGES";
    stagesPoint.sleep.summary.stagesSummary = [
      { type: "DEEP", minutes: "60", count: "4" },
      { type: "LIGHT", minutes: "200", count: "10" },
      { type: "REM", minutes: "73", count: "5" },
    ];
    const { client } = fakeClient({ dataPoints: [stagesPoint] });
    const summary = await getSleepSummary(user, client, {
      date: "2026-07-09",
      timezone: "America/Chicago",
    });
    expect(summary.mainSession?.stagesSummary).toHaveLength(3);
    expect(summary.freshness.note).not.toContain("CLASSIC");
  });
});

describe("makeFreshness thresholds", () => {
  it("flags sample data stale after 3h but daily data fresh for 48h", () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    expect(makeFreshness(twelveHoursAgo).isPossiblyStale).toBe(true);
    expect(
      makeFreshness(twelveHoursAgo, undefined, { staleAfterHours: DAILY_STALE_AFTER_HOURS })
        .isPossiblyStale,
    ).toBe(false);
    const threeDaysAgo = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    expect(
      makeFreshness(threeDaysAgo, undefined, { staleAfterHours: DAILY_STALE_AFTER_HOURS })
        .isPossiblyStale,
    ).toBe(true);
  });
});
