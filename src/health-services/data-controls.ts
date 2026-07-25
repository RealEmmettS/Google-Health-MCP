import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  appUsers,
  dataFreshness,
  healthCache,
  healthUpdateInbox,
  mutationAuditLog,
  oauthConnections,
  webhookEvents,
} from "../db/schema";
import {
  decryptAccessToken,
  decryptRefreshToken,
  getConnection,
  loadTokenRow,
} from "../auth/token-store";

type RevocationStatus = "revoked" | "not_available" | "failed";

async function revokeGoogleTokenBestEffort(userId: string): Promise<RevocationStatus> {
  const connection = await getConnection(userId);
  if (!connection) return "not_available";
  const tokenRow = await loadTokenRow(connection.id);
  if (!tokenRow) return "not_available";
  const token = decryptRefreshToken(tokenRow) ?? decryptAccessToken(tokenRow);
  if (!token) return "not_available";
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? "revoked" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Disconnects Google Health and removes locally held connection-derived data.
 * Mutation audit history remains until the user requests full stored-data
 * deletion because it is needed to account for writes made through the MCP.
 */
export async function disconnectGoogleHealth(userId: string): Promise<{
  disconnected: boolean;
  googleRevocation: RevocationStatus;
}> {
  const googleRevocation = await revokeGoogleTokenBestEffort(userId);
  await db.delete(webhookEvents).where(eq(webhookEvents.userId, userId));
  await db.delete(healthUpdateInbox).where(eq(healthUpdateInbox.userId, userId));
  await db.delete(dataFreshness).where(eq(dataFreshness.userId, userId));
  await db.delete(healthCache).where(eq(healthCache.userId, userId));
  await db.delete(oauthConnections).where(eq(oauthConnections.userId, userId));
  const updated = await db
    .update(appUsers)
    .set({
      googleHealthUserId: null,
      legacyFitbitUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(appUsers.id, userId))
    .returning({ id: appUsers.id });
  return { disconnected: updated.length > 0, googleRevocation };
}

/**
 * Deletes all locally stored Google Health domain data for one resolved user.
 * The Better Auth identity and MCP authorization remain so the person can
 * authenticate, see the empty state, and reconnect later if still allowlisted.
 */
export async function deleteStoredHealthData(userId: string): Promise<{
  deleted: boolean;
  googleRevocation: RevocationStatus;
}> {
  const googleRevocation = await revokeGoogleTokenBestEffort(userId);
  await db.delete(mutationAuditLog).where(eq(mutationAuditLog.userId, userId));
  await db.delete(webhookEvents).where(eq(webhookEvents.userId, userId));
  const deleted = await db
    .delete(appUsers)
    .where(eq(appUsers.id, userId))
    .returning({ id: appUsers.id });
  return { deleted: deleted.length > 0, googleRevocation };
}
