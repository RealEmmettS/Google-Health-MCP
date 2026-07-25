import type { AppUser } from "../auth/app-user";
import { getConnection } from "../auth/token-store";
import type { GoogleHealthClient } from "../google-health/client";
import { nowIn, toCivilDateString, todayRange } from "../time/ranges";
import { makeFreshness, maxTime, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, num, str } from "./shape";
import { getFreshnessLedger } from "./updates";

export interface SyncStatus {
  connection: {
    status: string;
    scopes: string[];
    connectedAt?: string;
  } | null;
  identity: {
    healthUserId?: string;
    legacyFitbitUserId?: string;
  };
  devices: unknown[];
  syncedThrough?: string;
  timezone: string;
  recentNotifications: Array<{
    dataType: string;
    lastNotifiedAt?: string;
    lastOperation?: string;
    lastInterval?: unknown;
  }>;
  freshness: Freshness;
}

/** Connection health + device battery + a synced-through proxy (steps). */
export async function getSyncStatus(
  user: AppUser,
  client: GoogleHealthClient,
): Promise<SyncStatus> {
  const [timezone, connection, deviceResponse, recentNotifications] = await Promise.all([
    getUserTimezone(user, client),
    getConnection(user.id),
    client.listPairedDevices().catch(() => undefined),
    getFreshnessLedger(user.id),
  ]);
  const response = asRec(deviceResponse);
  const devices = (Array.isArray(response.pairedDevices) ? response.pairedDevices : [])
    .slice(0, 5)
    .map((device) => {
      const record = asRec(device);
      return {
        deviceVersion: str(record.deviceVersion),
        deviceType: str(record.deviceType),
        batteryLevel: num(record.batteryLevel),
        batteryStatus: str(record.batteryStatus),
      };
    });

  const hourly = await client
    .rollUp({
      dataType: "steps",
      range: todayRange(timezone),
      windowSize: "3600s",
    })
    .catch(() => undefined);
  const syncedThrough = maxTime(
    ...(hourly?.rollupDataPoints ?? []).map((point) =>
      str(asRec(point).endTime),
    ),
  );

  return {
    connection: connection
      ? {
          status: connection.status,
          scopes: connection.scopes,
          connectedAt: connection.connectedAt?.toISOString(),
        }
      : null,
    identity: {
      healthUserId: user.googleHealthUserId ?? undefined,
      legacyFitbitUserId: user.legacyFitbitUserId ?? undefined,
    },
    devices,
    syncedThrough,
    timezone,
    recentNotifications: recentNotifications.slice(0, 20),
    freshness: makeFreshness(
      syncedThrough,
      `syncedThrough is the end of the newest steps rollup bucket on ${toCivilDateString(nowIn(timezone))}; a zero bucket may be a real observation.`,
    ),
  };
}
