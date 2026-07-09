import type { AppUser } from "../auth/app-user";
import type { GoogleHealthClient } from "../google-health/client";
import { DEFAULT_TIMEZONE } from "../time/ranges";
import { readThrough } from "./cache";

/**
 * Profile/settings reads (cached 1h — the only cached surface in v1).
 * Live-verified 2026-07-09: getProfile returns age/membershipStartDate/
 * stride lengths; getSettings returns units/locale/timeZone (NO step goal —
 * the v4 API has no goals surface).
 */

const TTL_SECONDS = 3600;

export interface HealthSettings {
  timeZone?: string;
  distanceUnit?: string;
  weightUnit?: string;
  heightUnit?: string;
  waterUnit?: string;
  temperatureUnit?: string;
  [key: string]: unknown;
}

export async function getProfileCached(
  user: AppUser,
  client: GoogleHealthClient,
): Promise<unknown> {
  return readThrough(user.id, "profile", TTL_SECONDS, () => client.getProfile());
}

export async function getSettingsCached(
  user: AppUser,
  client: GoogleHealthClient,
): Promise<HealthSettings> {
  return readThrough(user.id, "settings", TTL_SECONDS, () =>
    client.getSettings(),
  ) as Promise<HealthSettings>;
}

/** Settings.timeZone is authoritative; app_users default is the fallback. */
export async function getUserTimezone(
  user: AppUser,
  client: GoogleHealthClient,
): Promise<string> {
  try {
    const settings = await getSettingsCached(user, client);
    if (typeof settings.timeZone === "string" && settings.timeZone.length > 0) {
      return settings.timeZone;
    }
  } catch {
    // fall through to defaults — timezone resolution must never break a read
  }
  return user.defaultTimezone || DEFAULT_TIMEZONE;
}
