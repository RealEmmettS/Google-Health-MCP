import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  GoogleApiError,
  MissingScopeError,
  RateLimitedError,
} from "../../src/google-health/errors";

vi.mock("../../src/auth/token-service", () => ({
  getValidAccessToken: vi.fn(),
}));
vi.mock("../../src/auth/token-store", () => ({
  getConnection: vi.fn(),
}));

import { getValidAccessToken } from "../../src/auth/token-service";
import { getConnection } from "../../src/auth/token-store";
import { GoogleHealthClient } from "../../src/google-health/client";
import { HEALTH_SCOPES } from "../../src/google-health/scopes";
import { dailyRollupCivilRange } from "../../src/time/ranges";

const mockedToken = vi.mocked(getValidAccessToken);
const mockedConnection = vi.mocked(getConnection);
const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mockedToken.mockResolvedValue("ya29.test");
  mockedConnection.mockResolvedValue({
    id: "conn-1",
    scopes: [...HEALTH_SCOPES],
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GoogleHealthClient", () => {
  it("lists data points with kebab path, capped pageSize, and auth header", async () => {
    fetchMock.mockResolvedValueOnce(ok({ dataPoints: [], nextPageToken: "" }));
    const client = new GoogleHealthClient("user-1");
    await client.listDataPoints({
      dataType: "body-fat",
      filter: 'body_fat.sample_time.physical_time >= "2026-07-01T00:00:00Z"',
      pageSize: 500,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/v4/users/me/dataTypes/body-fat/dataPoints");
    expect(parsed.searchParams.get("pageSize")).toBe("100"); // capped
    expect(parsed.searchParams.get("filter")).toContain("body_fat.sample_time");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ya29.test",
    );
  });

  it("rejects unknown data types", async () => {
    const client = new GoogleHealthClient("user-1");
    await expect(
      client.listDataPoints({ dataType: "not-a-type" }),
    ).rejects.toMatchObject({ code: "unknown_data_type" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects operations the data type does not support", async () => {
    const client = new GoogleHealthClient("user-1");
    // total-calories supports only rollup/dailyRollup.
    await expect(
      client.listDataPoints({ dataType: "total-calories" }),
    ).rejects.toMatchObject({ code: "unsupported_operation" });
  });

  it("throws MissingScopeError before calling the API", async () => {
    mockedConnection.mockResolvedValue({ id: "c", scopes: [] } as never);
    const client = new GoogleHealthClient("user-1");
    await expect(client.listDataPoints({ dataType: "steps" })).rejects.toThrow(
      MissingScopeError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once with a forced refresh on 401", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(ok({ dataPoints: [] }));
    const client = new GoogleHealthClient("user-1");
    await client.listDataPoints({ dataType: "steps" });

    expect(mockedToken).toHaveBeenCalledTimes(2);
    expect(mockedToken).toHaveBeenNthCalledWith(1, "user-1", { forceRefresh: false });
    expect(mockedToken).toHaveBeenNthCalledWith(2, "user-1", { forceRefresh: true });
  });

  it("backs off on 429 and eventually succeeds", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
        .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
        .mockResolvedValueOnce(ok({ dataPoints: [] }));
      const client = new GoogleHealthClient("user-1");
      const promise = client.listDataPoints({ dataType: "steps" });
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(promise).resolves.toEqual({ dataPoints: [] });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces RateLimitedError with Retry-After when retries are exhausted", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(
        new Response("slow down", { status: 429, headers: { "Retry-After": "60" } }),
      );
      const client = new GoogleHealthClient("user-1");
      const promise = client.listDataPoints({ dataType: "steps" });
      const assertion = expect(promise).rejects.toMatchObject({
        code: "rate_limited",
        retryAfterSeconds: 60,
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("wraps other API failures with redacted messages", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom", token: "ya29.leak" }), {
        status: 500,
      }),
    );
    const client = new GoogleHealthClient("user-1");
    try {
      await client.listDataPoints({ dataType: "steps" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleApiError);
      expect((error as Error).message).not.toContain("ya29.");
    }
  });

  it("sends dailyRollUp civil ranges as plain numbers", async () => {
    fetchMock.mockResolvedValueOnce(ok({ rollupDataPoints: [] }));
    const client = new GoogleHealthClient("user-1");
    await client.dailyRollUp({
      dataType: "steps",
      range: dailyRollupCivilRange("2026-07-09", "2026-07-09"),
      windowSizeDays: 1,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/dataPoints:dailyRollUp");
    const body = JSON.parse(String(init.body));
    expect(body.windowSizeDays).toBe(1);
    expect(body.range.start.date.month).toBe(7);
    expect(typeof body.range.start.date.month).toBe("number");
  });

  it("reconciles with dataSourceFamily and passes pageToken through", async () => {
    fetchMock.mockResolvedValueOnce(ok({ dataPoints: [], nextPageToken: "tok2" }));
    const client = new GoogleHealthClient("user-1");
    const page = await client.reconcileDataPoints({
      dataType: "sleep",
      dataSourceFamily: "users/me/dataSourceFamilies/google-wearables",
      filter: 'sleep.interval.civil_end_time >= "2026-07-09"',
      pageToken: "tok1",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/v4/users/me/dataTypes/sleep/dataPoints:reconcile");
    expect(parsed.searchParams.get("dataSourceFamily")).toContain("google-wearables");
    expect(parsed.searchParams.get("pageToken")).toBe("tok1");
    expect(page.nextPageToken).toBe("tok2");
  });

  it("sends rollUp with a physical UTC range and windowSize", async () => {
    fetchMock.mockResolvedValueOnce(ok({ rollupDataPoints: [] }));
    const client = new GoogleHealthClient("user-1");
    await client.rollUp({
      dataType: "steps",
      range: { startTime: "2026-07-09T05:00:00Z", endTime: "2026-07-09T17:00:00Z" },
      windowSize: "3600s",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/dataTypes/steps/dataPoints:rollUp");
    const body = JSON.parse(String(init.body));
    expect(body.windowSize).toBe("3600s");
    expect(body.range.startTime).toBe("2026-07-09T05:00:00Z");
  });

  it("sends batchDelete with the names array", async () => {
    fetchMock.mockResolvedValueOnce(ok({ done: true }));
    const client = new GoogleHealthClient("user-1");
    await client.batchDeleteDataPoints("nutrition-log", [
      "users/1/dataTypes/nutrition-log/dataPoints/42",
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/dataTypes/nutrition-log/dataPoints:batchDelete");
    expect(JSON.parse(String(init.body)).names).toHaveLength(1);
  });
});
