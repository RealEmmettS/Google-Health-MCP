import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appUsers } from "../db/schema";

export type AppUser = typeof appUsers.$inferSelect;

/**
 * Resolves the domain user for a better-auth session by email (the join key
 * between auth layer 4 and the health-data domain). Creates the row on first
 * touch — only allowlisted accounts can ever reach this code path.
 */
export async function getOrCreateAppUser(
  email: string,
  displayName?: string | null,
): Promise<AppUser> {
  const normalized = email.trim().toLowerCase();
  const existing = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, normalized))
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(appUsers)
    .values({ email: normalized, displayName: displayName ?? null })
    .onConflictDoUpdate({
      target: appUsers.email,
      set: { updatedAt: new Date() },
    })
    .returning();
  return inserted[0];
}

export async function getAppUserByEmail(email: string): Promise<AppUser | null> {
  const rows = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, email.trim().toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}
