import { sql } from "drizzle-orm";
import { getOrCreateAppUser, type AppUser } from "../auth/app-user";
import { db } from "../db/client";
import { GoogleHealthError } from "../google-health/errors";

/**
 * Bridges auth layer 4 → the health domain: an MCP access token carries the
 * better-auth user id; the domain is keyed on app_users (joined by email).
 */
export async function resolveAppUser(betterAuthUserId: string): Promise<AppUser> {
  const result = await db.execute(
    sql`select "email", "name" from "user" where "id" = ${betterAuthUserId} limit 1`,
  );
  const row = result.rows?.[0] as { email?: string; name?: string } | undefined;
  if (!row?.email) {
    throw new GoogleHealthError(
      "unknown_user",
      "The authenticated MCP user could not be resolved.",
    );
  }
  return getOrCreateAppUser(row.email, row.name ?? null);
}
