/**
 * Diagnostic: raw GET against the live Google Health API with the stored
 * token. Usage: npx tsx scripts/gh-probe.ts /users/me/profile [email]
 */
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

async function main() {
  const path = process.argv[2];
  if (!path?.startsWith("/")) {
    console.error("usage: npx tsx scripts/gh-probe.ts </v4-relative-path> [email]");
    process.exit(1);
  }
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { GoogleHealthClient } = await import("../src/google-health/client");

  const email = process.argv[3] ?? "eshaughv@gmail.com";
  const user = await getAppUserByEmail(email);
  if (!user) throw new Error(`no app user for ${email}`);
  const client = new GoogleHealthClient(user.id);
  const result = await client.rawGet(path);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("probe failed:", error?.message ?? error);
  process.exit(1);
});
