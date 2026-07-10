/** Prints the scopes Google says are on the CURRENT access token. */
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

async function main() {
  const { getAppUserByEmail } = await import("../src/auth/app-user");
  const { getValidAccessToken } = await import("../src/auth/token-service");
  const user = await getAppUserByEmail(process.argv[2] ?? "eshaughv@gmail.com");
  if (!user) throw new Error("no user");
  const token = await getValidAccessToken(user.id);
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
  );
  const info = (await response.json()) as { scope?: string; expires_in?: string; error?: string };
  if (info.error) {
    console.log("tokeninfo error:", info.error);
    return;
  }
  console.log("expires_in:", info.expires_in);
  for (const scope of (info.scope ?? "").split(" ")) {
    console.log(scope.replace("https://www.googleapis.com/auth/googlehealth.", "gh."));
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
