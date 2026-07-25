import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../../src/auth/app-user";
import type { GoogleHealthClient } from "../../src/google-health/client";
import { getHealthTrends } from "../../src/health-services/trends";

const user = { id: "test-user" } as AppUser;

afterEach(() => {
  vi.useRealTimers();
});

describe("getHealthTrends", () => {
  it("preserves true zero buckets while leaving absent dates missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
    const client = {
      dailyRollUp: vi.fn(async () => ({
        rollupDataPoints: [
          {
            civilStartTime: { date: { year: 2026, month: 7, day: 24 }, time: {} },
            steps: { countSum: "0" },
          },
          {
            civilStartTime: { date: { year: 2026, month: 7, day: 25 }, time: {} },
            steps: { countSum: "4217" },
          },
        ],
      })),
      reconcileDataPoints: vi.fn(),
    } as unknown as GoogleHealthClient;

    const result = await getHealthTrends(user, client, {
      days: 7,
      metrics: ["steps"],
      timezone: "America/Chicago",
    });

    const trend = result.metrics[0];
    expect(trend.points).toHaveLength(7);
    expect(trend.points.find((point) => point.date === "2026-07-24")).toEqual({
      date: "2026-07-24",
      value: 0,
      status: "recorded",
    });
    expect(trend.points.find((point) => point.date === "2026-07-23")).toEqual({
      date: "2026-07-23",
      value: null,
      status: "missing",
    });
    expect(trend.summary.recordedDays).toBe(2);
    expect(trend.summary.missingDays).toBe(5);
  });

  it("extracts daily metrics using civil dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
    const client = {
      dailyRollUp: vi.fn(),
      reconcileDataPoints: vi.fn(async () => ({
        dataPoints: [
          {
            dailyRestingHeartRate: {
              date: { year: 2026, month: 7, day: 24 },
              beatsPerMinute: 58,
            },
          },
        ],
      })),
    } as unknown as GoogleHealthClient;

    const result = await getHealthTrends(user, client, {
      days: 7,
      metrics: ["resting-heart-rate"],
      timezone: "America/Chicago",
    });

    expect(result.metrics[0].points.find((point) => point.date === "2026-07-24"))
      .toMatchObject({ value: 58, status: "recorded" });
    expect(client.reconcileDataPoints).toHaveBeenCalledWith(
      expect.objectContaining({
        dataType: "daily-resting-heart-rate",
        filter: 'daily_resting_heart_rate.date >= "2026-07-19"',
      }),
    );
  });

  it("recognizes Google's live daily oxygen and respiratory field names", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
    const client = {
      dailyRollUp: vi.fn(),
      reconcileDataPoints: vi.fn(async ({ dataType }: { dataType: string }) => ({
        dataPoints:
          dataType === "daily-oxygen-saturation"
            ? [
                {
                  dailyOxygenSaturation: {
                    date: { year: 2026, month: 7, day: 24 },
                    averagePercentage: 96.2,
                  },
                },
              ]
            : [
                {
                  dailyRespiratoryRate: {
                    date: { year: 2026, month: 7, day: 24 },
                    breathsPerMinute: 15.1,
                  },
                },
              ],
      })),
    } as unknown as GoogleHealthClient;

    const result = await getHealthTrends(user, client, {
      days: 7,
      metrics: ["oxygen-saturation", "respiratory-rate"],
      timezone: "America/Chicago",
    });

    expect(result.metrics[0].summary.latestRecorded).toBe(96.2);
    expect(result.metrics[1].summary.latestRecorded).toBe(15.1);
  });

  it("sums logged hydration per day and labels missing days honestly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
    const client = {
      dailyRollUp: vi.fn(),
      reconcileDataPoints: vi.fn(async () => ({
        dataPoints: [
          {
            hydrationLog: {
              interval: { startTime: "2026-07-25T13:00:00Z" },
              volume: { value: 0.5, unit: "LITER" },
            },
          },
          {
            hydrationLog: {
              interval: { startTime: "2026-07-25T15:00:00Z" },
              volume: { value: 250, unit: "MILLILITER" },
            },
          },
        ],
      })),
    } as unknown as GoogleHealthClient;

    const result = await getHealthTrends(user, client, {
      days: 7,
      metrics: ["hydration"],
      timezone: "America/Chicago",
    });

    expect(result.metrics[0].summary.latestRecorded).toBe(750);
    expect(result.metrics[0].unit).toBe("mL logged");
    expect(result.metrics[0].note).toContain("missing data is not zero");
  });

  it("isolates a metric failure instead of failing the whole trend bundle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
    const client = {
      dailyRollUp: vi.fn(async () => ({ rollupDataPoints: [] })),
      reconcileDataPoints: vi.fn(async () => {
        throw new Error("upstream unavailable");
      }),
    } as unknown as GoogleHealthClient;

    const result = await getHealthTrends(user, client, {
      days: 7,
      metrics: ["steps", "resting-heart-rate"],
      timezone: "America/Chicago",
    });

    expect(result.metrics).toHaveLength(2);
    expect(result.metrics[0].error).toBeUndefined();
    expect(result.metrics[1].error?.code).toBe("metric_unavailable");
  });
});
