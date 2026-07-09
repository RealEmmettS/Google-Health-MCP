// Dev utility: list public tables in the Neon database (uses the direct URL).
// Usage: node scripts/db-inspect.mjs
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL_UNPOOLED / DATABASE_URL in env");
  process.exit(1);
}

const sql = neon(url);
const rows =
  await sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
console.log(rows.map((r) => r.table_name).join("\n"));
