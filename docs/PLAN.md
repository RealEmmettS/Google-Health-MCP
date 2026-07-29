# shaughv-health-mcp — Build Plan (v1)

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
2. **MCP auth = Google-federated OAuth**: our server is the OAuth authorization server via **better-auth's built-in `mcp` plugin**; the human login step is **Google Sign-In restricted to the identities in `ALLOWED_GOOGLE_EMAILS`**. No WorkOS/Clerk/etc.
3. **Webhooks deferred to v1.1.** V1 fetches fresh from Google on demand. V1.1 adds short-lived encrypted exact-response caching, pointer-only webhooks, a freshness ledger, and a short-lived update inbox. Webhook payloads contain NO health values — only `{healthUserId, dataType, operation, intervals}` pointers.
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

**Stack:** Next.js App Router, TypeScript, **Node 24 runtime** (not Edge — needs `node:crypto`, DB driver), official `@modelcontextprotocol/server` 2.0.0 (`legacy: "stateless"`, `responseMode: "auto"`), Vercel Fluid Compute in `iad1`, checkpoint-0.2.1 `better-auth` built-in `mcp` auth bridge, Drizzle ORM + `@neondatabase/serverless`, Zod, Luxon (timezones), Vitest + MSW/undici-mocks for tests. The coordinated stable OAuth Provider/JWT cutover is `#oap`; see [ADR-0003](adr/0003-vercel-node-fluid-mcp-2026.md).

### Four auth layers — never conflate (handoff §3)
1. Vercel account login — Emmett's, irrelevant to runtime.
2. Neon Auth — **disabled**. Neon is only a database.
3. **Google Health consent** (health scopes): custom routes `/api/auth/google-health/start` + `/callback`. `access_type=offline`, `prompt=consent`. Tokens AES-256-GCM-encrypted in Neon. Done ONCE (per reconnect), independent of how many MCP clients connect.
4. **MCP client auth**: better-auth OAuth 2.1 AS with `allowDynamicClientRegistration: true`; login = Google Sign-In (basic `openid email profile` only); **reject any Google account not in `ALLOWED_GOOGLE_EMAILS`**. In checkpoint 0.2.1, Better Auth's `withMcpAuth` verifies its opaque token before passing typed auth context to the official SDK handler. Serve `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`. `#oap` replaces the compatibility bridge with local audience-bound JWT verification.

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

Better-auth generates its own tables (user, session, account, verification, oauthApplication, oauthAccessToken, oauthConsent — exact set per current better-auth CLI codegen). Domain tables:

- `app_users` — id, email (links to better-auth user email), display_name, default_timezone (default `America/Chicago`), google_health_user_id (unique), legacy_fitbit_user_id, timestamps.
- `oauth_connections` — per handoff §13.2 (status: active/reauth_required/revoked, scopes[]).
- `oauth_tokens` — per §13.3: ciphertext/iv/tag per token, expiries, key_version.
- `oauth_states` — per §13.4 (hashed state, expiry, consumed_at) for the health-consent flow.
- `mutation_audit_log` — per §13.8. Every write tool logs here.
- `webhook_events` — per §13.5. **Dormant until v1.1.**
- `data_freshness` — NEW (Emmett's ask): user_id, data_type, last_notified_at, last_operation, last_interval jsonb, unique(user_id, data_type). Dormant until v1.1; v1 freshness metadata comes from data timestamps + retrievedAt.
- `health_cache` — per §13.7 but used ONLY for profile/settings/identity/data-type catalog (TTL ~1h). All health data fetches are live in v1. `cache_invalidations` table deferred entirely to v1.1.

Runtime DB access via pooled URL; `drizzle-kit` migrations run from dev machine against `DATABASE_URL_UNPOOLED`.

## Security invariants
- AES-256-GCM app-level encryption for Google tokens; key from `TOKEN_ENCRYPTION_KEY` (32-byte base64); store iv/tag/key_version. NEVER plaintext tokens in DB, logs, or errors — build a `redact()` helper and use it in all error paths.
- Token refresh: `getValidAccessToken(userId)` refreshes when <5 min to expiry, using an atomic, expiring claim on the token row for best-effort **single-flight** behavior with the stateless Neon HTTP driver; on refresh failure mark connection `reauth_required`.
- `/api/auth/google-health/start` requires an authenticated, allowlisted better-auth session — not world-startable.
- Write tools: validate with Zod, refuse unsupported writes, audit-log every mutation.
- No medical diagnosis language anywhere; freshness/limitation notes on every response (handoff §19–20).

## Routes
```
app/api/[transport]/route.ts               MCP endpoint: official v2 handler, legacy stateless fallback, HTTP boundary, Node/iad1, maxDuration 60s
app/api/auth/[...all]/route.ts             better-auth handler (Google sign-in, /authorize, /token, DCR /register)
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

## MCP surface (v1)
**Read tools** (all responses include `freshness: {retrievedAt, latestDataTime?, isPossiblyStale, note}` + units + bounded payloads):
`get_today_steps` (steps + goal from settings if available + remaining; never invent a goal), `get_sleep_summary` (last_night|date modes), `get_latest_heart_rate` (lookback + optional context, "latest synced, not live" note), `get_exercise_week`, `get_nutrition_log`, `get_health_context` (fatigue|heart_rate|general bundle: sleep + latest HR + resting HR/HRV + recent activity + nutrition/hydration; data only, no conclusions), `query_health_data` (generic list/reconcile against registry allowlist), `rollup_health_data` (rollUp/dailyRollUp), `get_sync_status` (connection status, granted scopes, latest data times).
**Write tools** (Zod-validated, audited, return created dataPoint name): `create_nutrition_log`, `update_nutrition_log`, `delete_nutrition_log`, `create_hydration_log`, `update_measurement` (weight|body-fat|height). `update_profile` ONLY if the live v4 REST reference confirms a writable profile endpoint+fields — check during build, do not invent; drop the tool if unsupported.
**Resources:** `health://profile`, `health://settings`, `health://connected-user`, `health://data-types`, `health://freshness`. Prompts: skip in v1 (YAGNI).
**Absent by design:** sleep/exercise/settings writes, bulk historical writes.
Input schemas exactly per handoff §11 (they're good). Payload bounds: default pageSize ≤100, summarize HR series via rollups, truncation notes when capped.

---

## Phases (each = tasks on the board; commit per phase)

**Phase 0 — Bootstrap:** Run `/tasks-start` (scaffold `.tasks/`, create milestone + tasks mirroring these phases). Copy this plan into repo as `docs/PLAN.md`. Scaffold: `create-next-app@latest` (TS, App Router, no Tailwind needed — or minimal styling; SHAUGHV design optional later), install deps (`mcp-handler`, `@modelcontextprotocol/sdk`, `zod`, `better-auth`, `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`, `luxon`, `vitest`, `msw`), `.env.example`, README skeleton, `.env.development.local` with the Neon URL (gitignored). Cross-platform npm scripts (Windows dev box!).

**Phase 1 — DB + security foundation:** Drizzle schema (all tables above) + better-auth codegen tables; migrations applied to Neon; `src/security/encryption.ts` (AES-256-GCM + key_version), redaction helper, audit-log service. Unit tests: encrypt/decrypt roundtrip, tamper detection, redaction.

**Phase 2 — MCP auth (better-auth):** better-auth config: Google social provider (basic scopes), built-in MCP plugin, DCR on, email allowlist enforcement (reject non-allowlisted at sign-in callback), Drizzle adapter on Neon. Well-known metadata routes. Landing/dashboard pages. Verify locally: sign-in works, non-allowlisted account rejected, `/register` + `/authorize` + `/token` respond per spec. **The implemented version remains better-auth 1.6.23's deprecated built-in `mcp` plugin so existing connector state survives. Release 0.1.2 wraps its malformed OIDC response with required PKCE/resource checks and persisted RS256 JWKS signing. Keep that compatibility boundary intact until the coordinated maintained-provider migration in board task `#oap`; consult current docs before that migration because the APIs move quickly.**

**Phase 3 — Google Health consent + tokens:** start/callback routes, DB-backed state (hashed, 10-min expiry, single-use), token encrypt+store, `users/me/identity` fetch → store `healthUserId` + `legacyUserId`, reconnect path (update-not-duplicate, detect scope changes), `getValidAccessToken` with single-flight refresh. Tests: state lifecycle, refresh path, reauth_required on refresh failure (mocked token endpoint).

**Phase 4 — Google Health client:** registry + client + time utils + error normalization + pagination + 429 backoff. Integration tests against mocked v4 API (fixtures modeled on the real response shapes in the docs: steps list, sleep reconcile, exercise list, rollup, nutrition CRUD, expired-token, 429).

**Phase 5 — MCP endpoint + read tools + resources:** official SDK v2 `createMcpHandler` + Better Auth checkpoint bridge (tool handlers resolve app_user from authInfo), modern 2026 and stateless legacy 2025 transport, all read tools + resources, freshness metadata, payload bounding. Test with the matching official client and **MCP Inspector** through the full OAuth dance locally.

**Phase 6 — Write tools:** nutrition CRUD, hydration, measurements (+profile if API supports), audit logging, tests. Verify created/updated/deleted dataPoint names round-trip via `get_nutrition_log`.

**Phase 7 — Deploy + wire the world (Emmett-assisted):**
1. Push to GitHub → **Emmett: import repo in Vercel** (project name suggestion: `shaughv-health-mcp`), **connect Neon** in Storage tab.
2. Set env vars (Claude via `vercel link` + `vercel env add`, or Emmett in dashboard): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` (prod URL), `ALLOWED_GOOGLE_EMAILS`. (`DATABASE_URL` comes from the Neon integration.)
3. **Emmett in Google console:** finish the OAuth client — add redirect URIs:
   `https://<prod-domain>/api/auth/callback/google`, `https://<prod-domain>/api/auth/google-health/callback`, `http://localhost:3000/api/auth/callback/google`, `http://localhost:3000/api/auth/google-health/callback` — then **publish the app to "In production"** (Audience page). Claude can drive this via Chrome MCP with Emmett watching.
4. Deploy, run migrations, complete health consent on prod, run E2E below.

**Phase 8 = v1.1 (separate, later):** webhooks — GCP service account + Google Health IAM role + project NUMBER, subscriber registration (AUTOMATIC policy for granted-scope data types), endpoint auth secret + two-part verification handshake (200/201 authed, 401/403 unauthed), `GOOGLE-HEALTH-API-SIGNATURE` verification against Google's public keyset (Tink prefix parsing → ECDSA P-256), idempotent event insert (hash), populate `data_freshness`, respond 204 fast. Store event + ledger BEFORE responding; `waitUntil` only for non-critical work.

---

## Verification / E2E (definition of done for v1)

1. **Unit + integration suites pass** (`npm test`): crypto, state, refresh, ranges (incl. DST + midnight-crossing sleep), registry mapping, tool schemas, error shapes, mocked-API flows.
2. **MCP Inspector** connects via OAuth locally and on prod; tools/resources discoverable with sane schemas.
3. **Real clients** (the actual acceptance test):
   - Claude Code: `claude mcp add --transport http health https://<prod>/api/mcp` → OAuth browser dance → tools work.
   - claude.ai (web AND mobile): Settings → Connectors → Add custom connector → URL → OAuth → test.
   - ChatGPT: custom connector via DCR → test.
4. **Prompt battery** against a real client (with Fitbit synced): "How many steps do I have today?" / "What's left to hit my goal?" / "How much did I sleep last night?" / "Why am I tired?" / "Why is my heart rate so high?" / "What did I eat yesterday?" / "What's my exercise looking like this week?" / "Log a snack: Greek yogurt, 150 cal, 15g protein." / "Edit that entry to 180 calories." / "Delete it." / "Log 16 oz of water." / "Update my weight to X."
   Expect: grounded numbers with timestamps + freshness notes; no invented goals; nutrition mutations visible in Fitbit app after sync; audit rows present; "no data logged" ≠ "you didn't eat".
5. **Negative checks:** MCP endpoint returns 401 without a valid token; non-allowlisted Google account cannot complete sign-in; no plaintext tokens in DB (inspect rows) or logs; 429/expired-token paths degrade with the specified error shapes.

## Watchouts (Opus: read before coding)
- **better-auth MCP plugin API is fresh (July 2026 package split)** — fetch current docs via Context7 at build time; don't code from memory. Same for `mcp-handler` `withMcpAuth` + protected-resource helpers.
- **claude.ai OAuth quirks:** token endpoint must accept form-encoded POST (community issue #313); test the claude.ai connector EARLY in Phase 7, not last.
- **Refresh tokens:** only issued with `access_type=offline` + typically `prompt=consent`; don't assume one on every exchange. 7-day expiry until Emmett publishes the app.
- **Kebab vs snake data-type names** (endpoint `body-fat` vs filter `body_fat`) — registry only, no ad-hoc conversion.
- **Civil time vs UTC:** rollUp takes physical-time range; dailyRollUp takes civil range with non-zero-padded month/day ints (API rejects leading zeros — "Octal/hex numbers are not valid JSON"). Sleep sessions cross midnight.
- **True zeros / on-wrist filtering:** missing data ≠ zero activity; never phrase gaps as inactivity.
- **Node runtime everywhere** (crypto, DB); no edge. Vercel serverless: nothing survives the response — no fire-and-forget background work.
- **Neon:** pooled URL at runtime, unpooled for migrations.
- **profile/settings writes:** verify the live REST reference first; drop `update_profile` if the API lacks it.
- **Payloads:** cap and summarize; an LLM doesn't need 1,440 HR samples.
- **Windows dev machine:** cross-platform scripts only.
- **Never log tokens/Authorization headers; redact all error paths.**

## Emmett's manual checklist (only-human steps)
☐ Import repo into Vercel + connect Neon (Phase 7.1) · ☐ Approve/paste env vars (7.2) · ☐ Add redirect URIs + publish OAuth app to production (7.3) · ☐ Run the Google Health consent flow on prod · ☐ Add connectors in claude.ai / ChatGPT / Claude Code · ☐ (v1.1) create service account + IAM role · ☐ Optional: rotate Neon password; add custom domain later (then add its redirect URIs + update env).
