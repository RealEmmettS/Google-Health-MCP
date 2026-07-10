import { DateTime } from "luxon";

/**
 * Freshness metadata attached to every tool response (docs/PLAN.md §19).
 * Language discipline: "latest synced", never "live"/"current".
 */
export interface Freshness {
  retrievedAt: string;
  latestDataTime?: string;
  isPossiblyStale: boolean;
  note: string;
}

const BASE_NOTE =
  "Google Health data reflects the last Fitbit device sync — it is not a live sensor feed.";

const STALE_AFTER_HOURS = 3;

/**
 * Once-per-day metrics (sleep, daily-* aggregates) are computed nightly — a
 * value dated today or yesterday is CORRECT, not stale. 48h from the value's
 * date/midnight flags only a genuinely missed day.
 */
export const DAILY_STALE_AFTER_HOURS = 48;

export function makeFreshness(
  latestDataTime?: string | null,
  extraNote?: string,
  options?: { staleAfterHours?: number },
): Freshness {
  const staleAfterHours = options?.staleAfterHours ?? STALE_AFTER_HOURS;
  const latest = latestDataTime ? DateTime.fromISO(latestDataTime) : null;
  const isPossiblyStale =
    !latest?.isValid || DateTime.utc().diff(latest, "hours").hours > staleAfterHours;
  return {
    retrievedAt: new Date().toISOString(),
    latestDataTime: latest?.isValid ? latest.toUTC().toISO() ?? undefined : undefined,
    isPossiblyStale,
    note: extraNote ? `${BASE_NOTE} ${extraNote}` : BASE_NOTE,
  };
}

/** Max ISO instant among candidates (ignores missing/invalid). */
export function maxTime(...candidates: Array<string | null | undefined>): string | undefined {
  let best: DateTime | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const dt = DateTime.fromISO(candidate);
    if (dt.isValid && (!best || dt > best)) best = dt;
  }
  return best?.toUTC().toISO() ?? undefined;
}
