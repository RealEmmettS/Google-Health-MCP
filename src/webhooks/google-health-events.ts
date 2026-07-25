import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  appUsers,
  dataFreshness,
  healthCache,
  healthUpdateInbox,
  webhookEvents,
} from "../db/schema";

export interface GoogleHealthNotification {
  version: string;
  clientProvidedSubscriptionName?: string;
  healthUserId: string;
  operation: "UPSERT" | "DELETE";
  dataType: string;
  intervals: unknown[];
}

export interface WebhookProcessResult {
  eventHash: string;
  status: "processed" | "duplicate" | "unresolved";
  userId?: string;
}

/**
 * Persists only Google's notification pointer, never fetched health values.
 * Every step is idempotent so a partial database failure can safely return
 * 500 and let Google's delivery retry resume the same event.
 */
export async function processGoogleHealthNotification(
  notification: GoogleHealthNotification,
  rawBody: Buffer,
): Promise<WebhookProcessResult> {
  const eventHash = createHash("sha256").update(rawBody).digest("hex");
  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.googleHealthUserId, notification.healthUserId))
    .limit(1);
  const now = new Date();

  const [inserted] = await db
    .insert(webhookEvents)
    .values({
      eventHash,
      healthUserId: notification.healthUserId,
      userId: user?.id ?? null,
      dataType: notification.dataType,
      operation: notification.operation,
      intervals: notification.intervals,
      payload: { data: notification },
      receivedAt: now,
      status: user ? "received" : "unresolved",
    })
    .onConflictDoNothing({ target: webhookEvents.eventHash })
    .returning({ id: webhookEvents.id, status: webhookEvents.status });

  if (!inserted) {
    const [existing] = await db
      .select({ status: webhookEvents.status, userId: webhookEvents.userId })
      .from(webhookEvents)
      .where(eq(webhookEvents.eventHash, eventHash))
      .limit(1);
    if (existing?.status === "processed" || existing?.status === "unresolved") {
      return {
        eventHash,
        status: "duplicate",
        userId: existing.userId ?? undefined,
      };
    }
  }

  if (!user) {
    await db
      .update(webhookEvents)
      .set({ processedAt: now, status: "unresolved" })
      .where(eq(webhookEvents.eventHash, eventHash));
    return { eventHash, status: "unresolved" };
  }

  await db
    .insert(dataFreshness)
    .values({
      userId: user.id,
      dataType: notification.dataType,
      lastNotifiedAt: now,
      lastOperation: notification.operation,
      lastInterval: notification.intervals.at(-1) ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [dataFreshness.userId, dataFreshness.dataType],
      set: {
        lastNotifiedAt: now,
        lastOperation: notification.operation,
        lastInterval: notification.intervals.at(-1) ?? null,
        updatedAt: now,
      },
    });

  await db
    .insert(healthUpdateInbox)
    .values({
      userId: user.id,
      eventHash,
      dataType: notification.dataType,
      operation: notification.operation,
      intervals: notification.intervals,
      notifiedAt: now,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    })
    .onConflictDoNothing({
      target: [healthUpdateInbox.userId, healthUpdateInbox.eventHash],
    });

  await db
    .delete(healthCache)
    .where(
      and(
        eq(healthCache.userId, user.id),
        eq(healthCache.dataType, notification.dataType),
      ),
    );

  await db
    .update(webhookEvents)
    .set({ userId: user.id, processedAt: now, status: "processed" })
    .where(eq(webhookEvents.eventHash, eventHash));

  return { eventHash, status: "processed", userId: user.id };
}
