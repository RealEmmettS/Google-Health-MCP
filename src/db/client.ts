import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as authSchema from "./auth-schema";
import * as schema from "./schema";

// Pooled DATABASE_URL at runtime (Neon via Vercel integration). The placeholder
// keeps config-time imports (better-auth CLI codegen, tests that never touch
// the DB) from crashing; any real query against it fails loudly.
const url =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export const db = drizzle(neon(url), {
  schema: { ...schema, ...authSchema },
});

export type Db = typeof db;
