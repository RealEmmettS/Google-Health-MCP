TT;DR: Create every database table (domain + better-auth), the AES-256-GCM token-encryption module, the log-redaction helper, and the mutation-audit service — the security floor everything else stands on.

## Why
Derived from approved plan (`docs/PLAN.md` → "Database schema" + "Security invariants"). Tokens must never exist in plaintext at rest; every write tool must leave an audit row.

## Plan
- Drizzle schema in `src/db/schema.ts`: `app_users`, `oauth_connections`, `oauth_tokens`, `oauth_states`, `mutation_audit_log`, `webhook_events` (dormant), `data_freshness` (dormant), `health_cache` — column specs in plan + handoff §13. Plus better-auth tables via `npx @better-auth/cli generate` (Drizzle adapter) — check both current docs via Context7 before coding.
- `src/db/client.ts`: `@neondatabase/serverless` + drizzle; pooled `DATABASE_URL` runtime, `DATABASE_URL_UNPOOLED` for drizzle-kit migrations (see drizzle.config.ts).
- `src/security/encryption.ts`: AES-256-GCM via `node:crypto`; key = 32-byte base64 `TOKEN_ENCRYPTION_KEY`; output {ciphertext, iv, tag, keyVersion}; constant-time-safe decrypt errors.
- `src/security/redact.ts`: strips bearer tokens / `access_token` / `refresh_token` / Authorization headers from any string/object before logging.
- `src/audit/mutation-audit.ts`: insert-only writer for `mutation_audit_log`.

## Impact
Migrations run against the live Neon DB (empty today — safe). Key risk: losing `TOKEN_ENCRYPTION_KEY` orphans all tokens → document key handling in README; key_version column enables rotation later.

## Acceptance
Migrations applied to Neon; all tables visible; crypto + redaction unit tests green.

## Verification
- [x] `npm run db:migrate` succeeds against Neon (unpooled URL) — drizzle/0000_init.sql applied
- [x] All domain + better-auth tables exist — 15 tables verified via scripts/db-inspect.mjs
- [x] Vitest: encrypt→decrypt roundtrip passes; tampered tag/iv/ciphertext fails closed (10 tests)
- [x] Vitest: redact() removes tokens from nested objects and Error messages (patterns: ya29., 1//, GOCSPX-, JWT, Bearer/Basic, npg_)
- [x] No plaintext secret storage path exists — schema has only ciphertext/iv/tag columns; encryption module is the sole plaintext boundary (token store lands in Phase 3 on top of it)

## Status
DONE. 28/28 unit tests green, typecheck clean. Notes: better-auth schema generated via @better-auth/cli (7 tables incl. oauth_application/access_token/consent — MCP plugin issues DB-backed opaque tokens, no jwks table). drizzle-kit talks to Neon over the unpooled URL. scripts/db-inspect.mjs is a keeper utility.

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
- 2026-07-09 00:56 — schema + client + crypto + redact + audit written; auth-schema generated; migration 0000_init applied to Neon; 15 tables verified (agent: fable)
- 2026-07-09 01:00 — 28 unit tests green; typecheck clean after TS7-strictness fixes; moved to Done (agent: fable)
