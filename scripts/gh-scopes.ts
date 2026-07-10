/** Prints the granted scopes stored on the connection. */
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

async function main() {
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { getConnection } = await import("../src/auth/token-store");
  const user = await getAppUserByEmail(process.argv[2] ?? "eshaughv@gmail.com");
  if (!user) throw new Error("no user");
  const conn = await getConnection(user.id);
  console.log(`status=${conn?.status} count=${conn?.scopes.length}`);
  for (const scope of conn?.scopes ?? []) console.log(scope);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
