import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not load Next-style env files on its own. Migrations use
// the DIRECT (unpooled) Neon connection per docs/PLAN.md.
config({ path: [".env.development.local", ".env"], quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED (or DATABASE_URL) is required for drizzle-kit",
  );
}

export default defineConfig({
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
});
