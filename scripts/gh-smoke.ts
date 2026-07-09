/**
 * Live smoke test against real Google Health data — run AFTER completing the
 * consent flow. Usage: npx tsx scripts/gh-smoke.ts [email]
 * Verifies: connection row, encrypted-token round trip, identity endpoint,
 * and a real steps dailyRollUp for today.
 */
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

async function main() {
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { getConnection } = await import("../src/auth/token-store");
  const { GoogleHealthClient } = await import("../src/google-health/client");
  const { dailyRollupCivilRange, nowIn, toCivilDateString } = await import(
    "../src/time/ranges"
  );

  const email = process.argv[2] ?? "eshaughv@gmail.com";
  const user = await getAppUserByEmail(email);
  if (!user) {
    console.log(`No app user for ${email} — sign in on the dashboard first.`);
    process.exit(1);
  }
  console.log(`app user: ${user.id}`);
  console.log(`healthUserId: ${user.googleHealthUserId ?? "(not mapped)"}`);
  console.log(`legacyFitbitUserId: ${user.legacyFitbitUserId ?? "(not mapped)"}`);

  const connection = await getConnection(user.id);
  if (!connection || connection.status !== "active") {
    console.log(
      `Connection status: ${connection?.status ?? "none"} — complete the consent flow first.`,
    );
    process.exit(1);
  }
  console.log(`connection: ${connection.status}, ${connection.scopes.length} scopes`);

  const client = new GoogleHealthClient(user.id);

  const identity = await client.getIdentity();
  console.log("identity:", JSON.stringify(identity));

  const today = toCivilDateString(nowIn(user.defaultTimezone));
  const rollup = await client.dailyRollUp({
    dataType: "steps",
    range: dailyRollupCivilRange(today, today, user.defaultTimezone),
    windowSizeDays: 1,
  });
  console.log(`steps dailyRollUp for ${today}:`, JSON.stringify(rollup, null, 2));
}

main().catch((error) => {
  console.error("smoke failed:", error?.message ?? error);
  process.exit(1);
});
