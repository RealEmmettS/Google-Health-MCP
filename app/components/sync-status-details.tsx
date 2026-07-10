import type { AppUser } from "@/src/auth/app-user";
import { GoogleHealthClient } from "@/src/google-health/client";
import { getSyncStatus } from "@/src/health-services/status";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatSyncTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
}

function DeviceStatus({ devices }: { devices: unknown[] }) {
  const device = asRecord(devices[0]);
  const version = stringValue(device.deviceVersion);
  const type = stringValue(device.deviceType);
  const batteryStatus = stringValue(device.batteryStatus);
  const batteryLevel = numberValue(device.batteryLevel);

  if (!version && !type && batteryLevel === undefined && !batteryStatus) {
    return (
      <div className="status-cell">
        <span className="status-label">Paired device</span>
        <strong className="status-value">Not available</strong>
        <span className="status-detail">No device metadata returned</span>
      </div>
    );
  }

  return (
    <div className="status-cell">
      <span className="status-label">Paired device</span>
      <strong className="status-value">
        {batteryLevel === undefined ? "Connected" : `${Math.round(batteryLevel)}%`}
      </strong>
      <span className="status-detail">
        {[version ?? type, batteryStatus].filter(Boolean).join(" / ") ||
          "Battery status unavailable"}
      </span>
    </div>
  );
}

export async function SyncStatusDetails({ user }: { user: AppUser }) {
  try {
    const client = new GoogleHealthClient(user.id);
    const status = await getSyncStatus(user, client);

    return (
      <>
        <div className="status-cell">
          <span className="status-label">Synced through</span>
          <strong className="status-value">
            {status.syncedThrough
              ? formatSyncTime(status.syncedThrough, status.timezone)
              : "Not available"}
          </strong>
          <span className="status-detail">Estimated from latest activity window</span>
        </div>
        <DeviceStatus devices={status.devices} />
      </>
    );
  } catch {
    return (
      <>
        <div className="status-cell">
          <span className="status-label">Synced through</span>
          <strong className="status-value">Unavailable</strong>
          <span className="status-detail">Sync details unavailable.</span>
        </div>
        <div className="status-cell">
          <span className="status-label">Paired device</span>
          <strong className="status-value">Unavailable</strong>
          <span className="status-detail">Connection state remains available</span>
        </div>
      </>
    );
  }
}
