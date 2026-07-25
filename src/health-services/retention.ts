import { lt } from "drizzle-orm";
import { db } from "../db/client";
import {
  healthCache,
  healthUpdateInbox,
  webhookEvents,
} from "../db/schema";

export async function expireShortLivedHealthData(now = new Date()): Promise<{
  cacheRows: number;
  updateRows: number;
  webhookEventRows: number;
}> {
  const webhookCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [cacheRows, updateRows, webhookEventRows] = await Promise.all([
    db
      .delete(healthCache)
      .where(lt(healthCache.expiresAt, now))
      .returning({ id: healthCache.id }),
    db
      .delete(healthUpdateInbox)
      .where(lt(healthUpdateInbox.expiresAt, now))
      .returning({ id: healthUpdateInbox.id }),
    db
      .delete(webhookEvents)
      .where(lt(webhookEvents.receivedAt, webhookCutoff))
      .returning({ id: webhookEvents.id }),
  ]);
  return {
    cacheRows: cacheRows.length,
    updateRows: updateRows.length,
    webhookEventRows: webhookEventRows.length,
  };
}
