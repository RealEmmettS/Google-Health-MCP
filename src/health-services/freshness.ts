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

export function makeFreshness(
  latestDataTime?: string | null,
  extraNote?: string,
): Freshness {
  const latest = latestDataTime ? DateTime.fromISO(latestDataTime) : null;
  const isPossiblyStale =
    !latest?.isValid || DateTime.utc().diff(latest, "hours").hours > STALE_AFTER_HOURS;
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
