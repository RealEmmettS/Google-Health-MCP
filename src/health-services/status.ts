import type { AppUser } from "../auth/app-user";
import { getConnection } from "../auth/token-store";
import type { GoogleHealthClient } from "../google-health/client";
import { nowIn, toCivilDateString, todayRange } from "../time/ranges";
import { makeFreshness, maxTime, type Freshness } from "./freshness";
import { getUserTimezone } from "./profile";
import { asRec, num, str } from "./shape";

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
  freshness: Freshness;
}

/** Connection health + device battery + a synced-through proxy (steps). */
export async function getSyncStatus(
  user: AppUser,
  client: GoogleHealthClient,
): Promise<SyncStatus> {
  const timezone = await getUserTimezone(user, client);
  const connection = await getConnection(user.id);

  let devices: unknown[] = [];
  try {
    const response = asRec(await client.listPairedDevices());
    devices = (Array.isArray(response.pairedDevices) ? response.pairedDevices : [])
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
  } catch {
    devices = []; // device listing is best-effort
  }

  let syncedThrough: string | undefined;
  try {
    const hourly = await client.rollUp({
      dataType: "steps",
      range: todayRange(timezone),
      windowSize: "3600s",
    });
    syncedThrough = maxTime(
      ...(hourly.rollupDataPoints ?? []).map((point) => {
        const record = asRec(point);
        const steps = num(asRec(record.steps).countSum) ?? 0;
        return steps > 0 ? str(record.endTime) : undefined;
      }),
    );
  } catch {
    syncedThrough = undefined;
  }

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
    freshness: makeFreshness(
      syncedThrough,
      `syncedThrough is inferred from the latest non-zero steps hour on ${toCivilDateString(nowIn(timezone))}.`,
    ),
  };
}
