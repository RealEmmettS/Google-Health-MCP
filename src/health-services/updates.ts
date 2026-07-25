import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { dataFreshness, healthUpdateInbox } from "../db/schema";
import { GoogleHealthError } from "../google-health/errors";

export interface HealthUpdate {
  id: string;
  dataType: string;
  operation: string;
  intervals: unknown;
  status: string;
  notifiedAt: string;
  expiresAt: string;
}

export async function getHealthUpdates(
  userId: string,
  args: { includeAcknowledged?: boolean; limit?: number } = {},
): Promise<{
  updates: HealthUpdate[];
  pendingCount: number;
  note: string;
}> {
  const now = new Date();
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
  const conditions = [
    eq(healthUpdateInbox.userId, userId),
    gt(healthUpdateInbox.expiresAt, now),
  ];
  if (!args.includeAcknowledged) {
    conditions.push(eq(healthUpdateInbox.status, "pending"));
  }

  const [rows, pendingRows] = await Promise.all([
    db
      .select()
      .from(healthUpdateInbox)
      .where(and(...conditions))
      .orderBy(desc(healthUpdateInbox.notifiedAt))
      .limit(limit),
    db
      .select({ id: healthUpdateInbox.id })
      .from(healthUpdateInbox)
      .where(
        and(
          eq(healthUpdateInbox.userId, userId),
          eq(healthUpdateInbox.status, "pending"),
          gt(healthUpdateInbox.expiresAt, now),
        ),
      ),
  ]);

  return {
    updates: rows.map((row) => ({
      id: row.id,
      dataType: row.dataType,
      operation: row.operation,
      intervals: row.intervals,
      status: row.status,
      notifiedAt: row.notifiedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    })),
    pendingCount: pendingRows.length,
    note:
      "These are change notifications, not health values. Use a matching read or trend tool to fetch current Google Health data.",
  };
}

export async function acknowledgeHealthUpdates(
  userId: string,
  args: { updateIds?: string[]; allPending?: boolean },
): Promise<{ acknowledged: number; acknowledgedAt: string }> {
  const ids = [...new Set(args.updateIds ?? [])].slice(0, 50);
  if (!args.allPending && ids.length === 0) {
    throw new GoogleHealthError(
      "invalid_arguments",
      "Provide updateIds or set allPending=true.",
    );
  }
  const now = new Date();
  const filter = args.allPending
    ? and(
        eq(healthUpdateInbox.userId, userId),
        eq(healthUpdateInbox.status, "pending"),
      )
    : and(
        eq(healthUpdateInbox.userId, userId),
        eq(healthUpdateInbox.status, "pending"),
        inArray(healthUpdateInbox.id, ids),
      );
  const rows = await db
    .update(healthUpdateInbox)
    .set({ status: "acknowledged", acknowledgedAt: now, updatedAt: now })
    .where(filter)
    .returning({ id: healthUpdateInbox.id });
  return { acknowledged: rows.length, acknowledgedAt: now.toISOString() };
}

export async function getFreshnessLedger(userId: string): Promise<
  Array<{
    dataType: string;
    lastNotifiedAt?: string;
    lastOperation?: string;
    lastInterval?: unknown;
  }>
> {
  const rows = await db
    .select()
    .from(dataFreshness)
    .where(eq(dataFreshness.userId, userId))
    .orderBy(desc(dataFreshness.lastNotifiedAt));
  return rows.map((row) => ({
    dataType: row.dataType,
    lastNotifiedAt: row.lastNotifiedAt?.toISOString(),
    lastOperation: row.lastOperation ?? undefined,
    lastInterval: row.lastInterval ?? undefined,
  }));
}
