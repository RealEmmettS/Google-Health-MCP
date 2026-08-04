# shaughv-health-mcp — Architecture and release plan

**Repo:** `C:\Users\hey\git\Google-Health-MCP` · **Planned by:** Fable 5 with Emmett, 2026-07-08 · **v1 implemented and verified:** 2026-07-09

---

## Context

Emmett owns a Fitbit Air whose data lands in Google Health (the Fitbit Web API successor). He wanted a **remote MCP server on Vercel** so trusted LLM assistants can answer health questions from real data ("How many steps today?", "How did I sleep?", "Why am I tired?", "What did I eat yesterday?") and can **write** nutrition, hydration, and measurement entries that the device doesn't track. The MCP is a private, Emmett-only *thin, typed, authenticated data adapter* — the LLM does the reasoning. Not a warehouse, not analytics, no medical claims.

A detailed ChatGPT handoff spec exists at `C:\Users\hey\Downloads\shaughv-health-mcp_handoff_spec_v2.md`. It is directionally correct and this plan follows its structure, **except where decisions below override it** (MCP auth, webhooks timing, caching). Where they conflict, THIS PLAN WINS.

Accepted records under `docs/adr/` govern their specific decision scope and override older
plan wording. In particular,
[ADR-0002](adr/0002-single-user-private.md) fixes the current Emmett-only audience.
[ADR-0001](adr/0001-private-allowlist-only.md) remains the historical rationale for the
private, unverified posture and decision not to pursue public OAuth verification or CASA.

### Decisions made with Emmett (2026-07-08)
1. **Clients (v1):** Claude Code/Desktop, claude.ai web + mobile custom connectors, AND ChatGPT connectors → MCP auth must be **full OAuth 2.1 with Dynamic Client Registration**. (claude.ai/ChatGPT connectors do not support static bearer headers.)
2. **MCP auth = Google-federated OAuth**: our server is the OAuth authorization server via the stable **Better Auth OAuth Provider**; the human login step is **Google Sign-In restricted to the identities in `ALLOWED_GOOGLE_EMAILS`**. Google is identity only—its token is never an MCP bearer token. No WorkOS/Clerk/etc.
3. **v1.1 cache/update implementation is present; physical delivery remains open.** Short-lived
   encrypted exact-response caching, pointer-only webhooks, a freshness ledger, and the durable
   update inbox are implemented. Webhook payloads contain NO health values—only
   `{healthUserId, dataType, operation, intervals}` pointers. The real Fitbit-triggered delivery
   gate remains under `#w11/#q11` and is not closed by the MCP 0.3.0 work.
4. **Google OAuth app stays "In production" and unverified.** Production status avoids Testing's seven-day refresh-token lifetime. Public verification, the unverified first-100-user route, and CASA were evaluated and rejected; the exact audience and superseding requirements are in [ADR-0001](adr/0001-private-allowlist-only.md).

### Existing infrastructure
- **Neon Postgres:** `shaughv-health-db` was provisioned and connected from the Vercel dashboard through its Storage/Marketplace integration, rather than as a separately operated application service. Vercel injects pooled `DATABASE_URL` for runtime and unpooled `DATABASE_URL_UNPOOLED` for migrations. Local and production share this database and therefore share `TOKEN_ENCRYPTION_KEY`. Neon Auth is disabled.
- **Google Cloud:** Google Health API is enabled. OAuth web client "Shaughv OAuth Client 1" has both better-auth and Google Health callback URIs for the canonical domain, Vercel domain, and localhost. The OAuth app is External, In production, and intentionally unverified per ADR-0001.
- **Vercel:** production is live at `health.emmetts.dev`; Deployment Protection is preview-only because the application supplies its own runtime auth.

---

## Architecture

```
Fitbit Air → Fitbit app sync → Google Health cloud → Google Health API (health.googleapis.com/v4)
                                                            ↑ user OAuth token (encrypted in Neon)
LLM client (claude.ai / ChatGPT / Claude Code) ──OAuth 2.1 DCR──> Vercel Node/Fluid (`iad1`) ──> SDK v2 tools/resources
```

**Stack:** Next.js App Router, TypeScript, **Node 24 runtime** (not Edge — needs `node:crypto`, DB driver), official `@modelcontextprotocol/server` 2.0.0 (`legacy: "stateless"`, `responseMode: "auto"`), Vercel Fluid Compute in `iad1`, exact `better-auth` + `@better-auth/oauth-provider` 1.6.25, locally verified RS256 JWTs, Drizzle ORM + `@neondatabase/serverless`, Zod, Luxon (timezones), Vitest + MSW/undici-mocks. See [ADR-0003](adr/0003-vercel-node-fluid-mcp-2026.md).

### Four auth layers — never conflate (handoff §3)
1. Vercel account login — Emmett's, irrelevant to runtime.
2. Neon Auth — **disabled**. Neon is only a database.
3. **Google Health consent** (health scopes): custom routes `/api/auth/google-health/start` + `/callback`. `access_type=offline`, `prompt=consent`. Tokens AES-256-GCM-encrypted in Neon. Done ONCE (per reconnect), independent of how many MCP clients connect.
4. **MCP client auth**: Better Auth OAuth Provider with public DCR, S256 PKCE, explicit consent, hashed rotating refresh tokens, and one-hour RS256 JWT access tokens whose exact audience is `/api/mcp`; login = Google Sign-In (basic identity scopes only); **reject any Google account not in `ALLOWED_GOOGLE_EMAILS`**. Every MCP request verifies signature, issuer, exact audience, expiry, subject, scope, client, email, and the current environment allowlist locally. Serve root authorization/OpenID metadata plus canonical and legacy protected-resource metadata aliases. OAuth endpoints live under `/api/auth/oauth2/*`.

Layers 3 and 4 use the SAME Google OAuth client ID but separate flows/scopes — Google supports this; the health-flow refresh token is the one that matters for data access.

### Health scopes to request (flow #3)
```
googlehealth.activity_and_fitness.readonly
googlehealth.health_metrics_and_measurements.readonly
googlehealth.sleep.readonly
googlehealth.nutrition.readonly
googlehealth.profile.readonly
googlehealth.settings.readonly
googlehealth.nutrition.writeonly
googlehealth.health_metrics_and_measurements.writeonly
googlehealth.profile.writeonly
```
(All are on the consent screen. location/ecg/irn are configured but NOT requested in v1 — minimum-necessary. settings.writeonly is not configured → no settings-write tool.)

---

## Database schema (Drizzle migrations; handoff §13 with amendments)

Better Auth core uses `user`, `session`, `account`, and `verification`. The deprecated MCP bridge
used `oauth_application`, `oauth_access_token`, and `oauth_consent`; those legacy tables remain
rollback-only during `#q2` and are never queried by the 0.3.0 bearer path.

The 0.3.0 migration adds isolated provider tables `mcp_oauth_client_v2`,
`mcp_oauth_refresh_token_v2`, `mcp_oauth_access_token_v2`,
`mcp_oauth_consent_v2`, and `mcp_oauth_rate_limit_v2`, plus
`google_health_dpop_key`. `oauth_connections`, `oauth_tokens`, and the DPoP row carry a copied
credential generation/thumbprint so refresh/reconnect races can be rejected on the row being
updated. Legacy provider tables stay untouched through the rollback window.

- `app_users` — id, email (links to better-auth user email), display_name, default_timezone (default `America/Chicago`), google_health_user_id (unique), legacy_fitbit_user_id, timestamps.
- `oauth_connections` — per handoff §13.2 (status: active/reauth_required/revoked, scopes[]).
- `oauth_tokens` — per §13.3: ciphertext/iv/tag per token, expiries, key_version.
- `oauth_states` — per §13.4 (hashed state, expiry, consumed_at) for the health-consent flow.
- `mutation_audit_log` — per §13.8. Every write tool logs here.
- `webhook_events` — per §13.5. **Dormant until v1.1.**
- `data_freshness` — NEW (Emmett's ask): user_id, data_type, last_notified_at, last_operation, last_interval jsonb, unique(user_id, data_type). Dormant until v1.1; v1 freshness metadata comes from data timestamps + retrievedAt.
- `health_cache` — AES-256-GCM encrypted exact Google responses with per-user/request AAD;
  current data uses a 120-second TTL, historical ranges 30 minutes, and profile/settings
  one hour. Tool freshness always reports cache/live provenance, and force-refresh bypasses it.
- `health_update_inbox` — bounded durable local update notices sourced from verified pointer-only
  webhook events; acknowledgement changes local inbox state and never writes Health values.

Runtime DB access via pooled URL; `drizzle-kit` migrations run from dev machine against `DATABASE_URL_UNPOOLED`.

## Security invariants
- AES-256-GCM app-level encryption for Google tokens; key from `TOKEN_ENCRYPTION_KEY` (32-byte base64); store iv/tag/key_version. NEVER plaintext tokens in DB, logs, or errors — build a `redact()` helper and use it in all error paths.
- Each reconnected Google Health refresh token is sender-constrained to a per-connection P-256 DPoP key. The private JWK uses a purpose-derived HKDF subkey plus connection-id AAD; the working legacy credential is replaced only after a successful bound exchange and one atomic database statement.
- MCP access JWTs are not persisted. Only hashed rotating OAuth refresh tokens, client registrations, consent, rate-limit state, and encrypted Google credentials remain durable.
- Token refresh: `getValidAccessToken(userId)` refreshes when <5 min to expiry, using a DB-clock
  30-second lease plus direct target-row credential generation/thumbprint predicates. Contenders
  poll beyond the lease and must atomically reacquire; a reconnect makes stale refresh/nonce/lock
  writes fail their CAS instead of touching the replacement credential.
- `/api/auth/google-health/start` requires an authenticated, allowlisted better-auth session — not world-startable.
- Write tools: validate with Zod, refuse unsupported writes, audit-log every mutation.
- No medical diagnosis language anywhere; freshness/limitation notes on every response (handoff §19–20).

## Routes
```
app/api/[transport]/route.ts               MCP endpoint: official v2 handler, legacy stateless fallback, HTTP boundary, Node/iad1, maxDuration 60s
app/api/auth/[...all]/route.ts             better-auth sign-in + stable /oauth2 authorize/token/register/userinfo/JWKS
app/consent/page.tsx                       branded private OAuth consent (no health values)
app/.well-known/oauth-authorization-server/route.ts
app/.well-known/oauth-protected-resource/route.ts
app/api/auth/google-health/start/route.ts  health-scope consent redirect
app/api/auth/google-health/callback/route.ts  code exchange → encrypt+store → GET /v4/users/me/identity → store IDs → success page
app/page.tsx                               landing: Sign in with Google → dashboard (connection status, Connect/Reconnect Google Health button, MCP URL, client setup instructions)
app/api/health/status/route.ts             healthcheck (no secrets)
```
(v1.1 adds `app/api/webhooks/google-health/route.ts` — do not deploy a stub in v1.)

## Google Health client (`src/google-health/`)
Central `GoogleHealthClient` per handoff §18: resolves token, calls `https://health.googleapis.com/v4`, normalizes errors (handoff §21 error shapes: `google_health_not_connected`, `missing_scope`, `reauth_required`, `rate_limited` w/ backoff on 429, empty-data messaging), pagination, and a **data-type registry** (single source of truth): kebab endpoint name ↔ snake filter name ↔ scope ↔ allowed ops (from the data-types table in the docs Emmett pasted). Methods: list, get, reconcile, rollUp, dailyRollUp, create, patch, batchDelete. Time helpers (`src/time/`) with Luxon: today/yesterday/last-night/current-week ranges in user TZ (default America/Chicago), DST-safe, sleep-crossing-midnight logic (query sleep by `civil_end_time >= date`).

## MCP surface (19 tools, 6 resources)
**Local diagnostic tools:** `ping` and `get_connection_info` return privacy-safe
connection/protocol/auth/runtime metadata without touching Google Health.
**Health read tools** (all responses include `freshness: {retrievedAt, latestDataTime?, isPossiblyStale, note}` + units + bounded payloads):
`get_today_steps`, `get_sleep_summary`, `get_latest_heart_rate`,
`get_exercise_week`, `get_nutrition_log`, `get_health_context`
(fatigue|heart_rate|general data bundle; no conclusions), `get_health_trends` (bounded 7/30/90-day
coverage-aware summaries), `get_health_updates` (local durable inbox), `query_health_data`
(generic list/reconcile against the registry), `rollup_health_data`, and `get_sync_status`.
**Mutation/action tools** (Zod-validated; Health writes audited): `create_nutrition_log`,
`update_nutrition_log`, `delete_nutrition_log`, `create_hydration_log`, `update_measurement`
(weight|body-fat|height), and `acknowledge_health_updates` (local inbox only). `update_profile`
was dropped after the live v4 endpoint returned 403 despite its granted scope.
**Resources:** `health://profile`, `health://settings`, `health://connected-user`,
`health://data-types`, `health://freshness`, and `health://updates`. Prompts remain absent (YAGNI).
**Absent by design:** sleep/exercise/settings writes, bulk historical writes.
Input schemas exactly per handoff §11 (they're good). Payload bounds: default pageSize ≤100, summarize HR series via rollups, truncation notes when capped.

---

## Phases (each = tasks on the board; commit per phase)

**Phase 0 — Bootstrap (historical):** The original implementation used `mcp-handler` plus the monolithic SDK. Release 0.2.1 replaced both with the official split SDK v2 packages; do not restore the retired dependencies.

**Phase 1 — DB + security foundation:** Drizzle schema (all tables above) + better-auth codegen tables; migrations applied to Neon; `src/security/encryption.ts` (AES-256-GCM + key_version), redaction helper, audit-log service. Unit tests: encrypt/decrypt roundtrip, tamper detection, redaction.

**Phase 2 — MCP auth (stable 1.0.0; introduced in 0.3.0):** stable Better Auth OAuth Provider + JWT plugin, public DCR, S256 PKCE, exact resource binding, form-encoded token grants, email allowlist, consent, well-known metadata, and local JWT verification. The 0.1.2 deprecated-plugin repair remains historical rollback evidence only; its physical tables are retained for seven days and never queried by the new MCP route.

**Phase 3 — Google Health consent + tokens:** start/callback routes, DB-backed state (hashed, 10-min expiry, single-use), token encrypt+store, `users/me/identity` fetch → store `healthUserId` + `legacyUserId`, reconnect path (update-not-duplicate, detect scope changes), `getValidAccessToken` with single-flight refresh. Tests: state lifecycle, refresh path, reauth_required on refresh failure (mocked token endpoint).

**Phase 4 — Google Health client:** registry + client + time utils + error normalization + pagination + 429 backoff. Integration tests against mocked v4 API (fixtures modeled on the real response shapes in the docs: steps list, sleep reconcile, exercise list, rollup, nutrition CRUD, expired-token, 429).

**Phase 5 — MCP endpoint + read tools + resources:** official SDK v2 `createMcpHandler` + locally verified JWT auth context, modern 2026 and stateless legacy 2025 transport, all read tools + resources, freshness metadata, payload bounding. Test with the matching official client and **MCP Inspector** through the full OAuth dance locally.

**Phase 6 — Write tools:** nutrition CRUD, hydration, measurements (+profile if API supports), audit logging, tests. Verify created/updated/deleted dataPoint names round-trip via `get_nutrition_log`.

**Phase 7 — Original v1 deployment (historical):** Vercel, its Marketplace-provisioned Neon
database, Google redirects, production OAuth audience, custom domain, and environment variables
are already live. Do not repeat bootstrap steps or rotate credentials as part of 0.3.0.

**Current 0.3.0 cutover:** follow the
[cutover/rollback runbook](operations/0.3.0-cutover.md). Apply and verify migrations 0004–0006,
deploy the stable-provider candidate, prove safe metadata/DCR boundaries, then stop for fresh
approval before connector revocation/reconnect, Google DPoP reconsent, or legacy cleanup.

**Stable 1.0.0 release:** the product and MCP implementation identity promote the proven 0.3.0
line to 1.0.0 without changing the protocol SDK pin, tools, resources, schemas, endpoints, auth
behavior, or Health behavior. Historical 0.3.0 cutover and rollback receipts remain authoritative.

**Stable 1.0.1 patch:** preserves that public surface while repairing OAuth refresh and scope
discovery interoperability, adding privacy-safe lifecycle telemetry, and correcting responsive
website presentation. Package and MCP implementation identities advance together; the protocol
SDK pins, tool/resource schemas, endpoint URLs, database schema, and private audience remain fixed.

**Stable 1.1.0 connection diagnostics:** add one authenticated read-only `get_connection_info`
tool and extend `ping` with release/protocol/auth identifiers. Diagnostics expose the negotiated
and supported MCP revisions, Streamable HTTP/session posture, OAuth/PKCE/JWT/resource/refresh
configuration, current client/scopes/expiry, separate Google Health authorization status, and
runtime release markers. They never expose credential values, authorization headers, codes,
redirect payloads, or email. The MCP endpoint, private audience, database schema, Health behavior,
and existing tool inputs remain unchanged.

**Phase 8 = v1.1 (separate, later):** webhooks — GCP service account + Google Health IAM role + project NUMBER, subscriber registration (AUTOMATIC policy for granted-scope data types), endpoint auth secret + two-part verification handshake (200/201 authed, 401/403 unauthed), `GOOGLE-HEALTH-API-SIGNATURE` verification against Google's public keyset (Tink prefix parsing → ECDSA P-256), idempotent event insert (hash), populate `data_freshness`, respond 204 fast. Store event + ledger BEFORE responding; `waitUntil` only for non-critical work.

---

## Verification / E2E

1. **Unit + integration suites pass** (`npm test`): crypto, state, refresh, ranges (incl. DST + midnight-crossing sleep), registry mapping, tool schemas, error shapes, mocked-API flows.
2. **MCP Inspector** connects via OAuth locally and on prod; tools/resources discoverable with sane schemas.
3. **Real clients** (the actual acceptance test):
   - Claude Code: `claude mcp add --transport http health https://<prod>/api/mcp` → OAuth browser dance → tools work.
   - claude.ai (web AND mobile): Settings → Connectors → Add custom connector → URL → OAuth → test.
   - ChatGPT: custom connector via DCR → test.
   - Codex and Cursor: add the canonical remote MCP, complete OAuth, discover, ping, and read.
4. **Prompt battery** against a real client (with Fitbit synced): "How many steps do I have today?" / "What's left to hit my goal?" / "How much did I sleep last night?" / "Why am I tired?" / "Why is my heart rate so high?" / "What did I eat yesterday?" / "What's my exercise looking like this week?" / "Log a snack: Greek yogurt, 150 cal, 15g protein." / "Edit that entry to 180 calories." / "Delete it." / "Log 16 oz of water." / "Update my weight to X."
   Expect: grounded numbers with timestamps + freshness notes; no invented goals; nutrition mutations visible in Fitbit app after sync; audit rows present; "no data logged" ≠ "you didn't eat".
5. **Negative checks:** MCP endpoint returns 401 without a valid token; non-allowlisted Google account cannot complete sign-in; no plaintext tokens in DB (inspect rows) or logs; 429/expired-token paths degrade with the specified error shapes.

## Watchouts (Opus: read before coding)
- **Better Auth OAuth Provider 1.6.25 has a known resource-indicator advisory** — retain one configured audience, exact resource checks at authorize and authorization-code exchange, and exact single-string audience verification at `/api/mcp`. A refresh request may omit `resource` only while that one canonical resource is the complete configured set; the boundary inserts it before provider handling. Any supplied blank, wrong, or multiple value is rejected, and adding a second configured resource disables omission compatibility until explicit binding exists. Re-evaluate when a stable fixed release exists; do not jump to a beta silently.
- **Codex 0.146.0 drops the RFC 9207 `iss` callback parameter before validating it** — Better Auth continues emitting the exact issuer on successful and error redirects, but authorization and OpenID metadata temporarily advertise `authorization_response_iss_parameter_supported: false` so Codex does not require the value it discards. Remove this compatibility override only after the [Codex callback relay defect](https://github.com/openai/codex/issues/34684) is fixed and qualified locally.
- **Stable refresh rotation is not one provider transaction:** 1.6.25 compare-and-set revokes the
  predecessor and rejects sequential replay, then inserts the successor separately. Concurrent
  replay rejects the loser but may leave the winner live; a post-revocation insertion failure can
  strand the client. This private/allowlisted release tracks the upstream residual instead of
  hand-rolling token lineage or adopting a prerelease.
- **Trusted environments share the Vercel-linked Neon auth tables.** Production/preview/dev JWKS
  are separate, but public clients, consents, codes, refresh hashes, and rate limits are shared.
  Preview remains Vercel-protected and only the allowlisted owner can grant; isolate tables if
  previews become public or cease to be equally trusted.
- **claude.ai OAuth quirks:** token endpoint must accept form-encoded POST (community issue #313); test the claude.ai connector EARLY in Phase 7, not last.
- **Google refresh tokens:** only issued with `access_type=offline` + `prompt=consent`; do not replace the working credential unless Google returns a DPoP-bound refresh token and the atomic commit succeeds.
- **Kebab vs snake data-type names** (endpoint `body-fat` vs filter `body_fat`) — registry only, no ad-hoc conversion.
- **Civil time vs UTC:** rollUp takes physical-time range; dailyRollUp takes civil range with non-zero-padded month/day ints (API rejects leading zeros — "Octal/hex numbers are not valid JSON"). Sleep sessions cross midnight.
- **True zeros / on-wrist filtering:** missing data ≠ zero activity; never phrase gaps as inactivity.
- **Node runtime everywhere** (crypto, DB); no edge. Vercel serverless: nothing survives the response — no fire-and-forget background work.
- **Neon:** pooled URL at runtime, unpooled for migrations.
- **profile/settings writes:** verify the live REST reference first; drop `update_profile` if the API lacks it.
- **Payloads:** cap and summarize; an LLM doesn't need 1,440 HR samples.
- **Windows dev machine:** cross-platform scripts only.
- **Never log tokens/Authorization headers; redact all error paths.**

## Owner approval/physical gates

The infrastructure bootstrap is complete. Remaining owner gates are: approve any connector
removal/revocation immediately before it happens; complete ChatGPT, Claude.ai, Claude Code,
Codex, and Cursor reconnects; approve Google `prompt=consent` only after a DPoP-capable rollback
artifact exists; and approve legacy-table deletion after the seven-day soak. The independent
real Fitbit webhook delivery gate remains under `#w11/#q11`. Neon credential rotation is not a
1.0.0 requirement and must not be attempted without a separate fresh request.
