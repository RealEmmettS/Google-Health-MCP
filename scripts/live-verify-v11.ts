/**
 * Read-only v0.2/v1.1 acceptance: bounded trends plus encrypted-cache storage.
 * Usage: npx tsx scripts/live-verify-v11.ts [email]
 * Prints coverage/provenance only, never raw health values or secrets.
 */
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";

config({ path: ".env.development.local", quiet: true });

async function main() {
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { db } = await import("../src/db/client");
  const { healthCache } = await import("../src/db/schema");
  const { GoogleHealthClient } = await import("../src/google-health/client");
  const { getHealthTrends } = await import("../src/health-services/trends");

  const email = process.argv[2] ?? "eshaughv@gmail.com";
  const user = await getAppUserByEmail(email);
  if (!user) throw new Error(`No app user for ${email}`);
  const args = { days: 7 as const };

  const firstClient = new GoogleHealthClient(user.id);
  const first = await getHealthTrends(user, firstClient, args);
  const firstProvenance = firstClient.getDataProvenance();

  const secondClient = new GoogleHealthClient(user.id);
  const second = await getHealthTrends(user, secondClient, args);
  const secondProvenance = secondClient.getDataProvenance();

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      plaintext: sql<number>`count(*) filter (where ${healthCache.payload} is not null)::int`,
      incompleteCipher: sql<number>`count(*) filter (where ${healthCache.payloadCiphertext} is null or ${healthCache.payloadIv} is null or ${healthCache.payloadTag} is null)::int`,
    })
    .from(healthCache)
    .where(eq(healthCache.userId, user.id));

  console.log(
    JSON.stringify(
      {
        first: {
          source: firstProvenance.source,
          coverage: first.metrics.map((metric) => ({
            metric: metric.metric,
            recordedDays: metric.summary.recordedDays,
            missingDays: metric.summary.missingDays,
            error: metric.error?.code,
          })),
        },
        second: {
          source: secondProvenance.source,
          operations: secondProvenance.operations,
          coverageStable:
            JSON.stringify(first.metrics.map((metric) => metric.summary)) ===
            JSON.stringify(second.metrics.map((metric) => metric.summary)),
        },
        cacheStorage: counts,
      },
      null,
      2,
    ),
  );

  if (
    secondProvenance.source !== "cache" ||
    !counts ||
    counts.plaintext !== 0 ||
    counts.incompleteCipher !== 0
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("v1.1 live verification failed:", error?.message ?? error);
  process.exit(1);
});
