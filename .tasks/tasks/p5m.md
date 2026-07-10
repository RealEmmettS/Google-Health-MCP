TT;DR: Wire the MCP endpoint (mcp-handler + withMcpAuth verifying better-auth tokens) and ship all nine read tools and five resources, every response carrying freshness metadata and bounded payloads — verified end-to-end with MCP Inspector.

## Why
This is the product surface. `docs/PLAN.md` §"MCP surface (v1)"; schemas per handoff §11.

## Plan
- ARCHITECTURE NOTE (added 2026-07-09 for future #api REST surface): keep tool handlers THIN — input parsing/validation only; put ALL orchestration (Google Health calls, range logic, freshness computation, response shaping) in reusable service functions under `src/health-services/`. A future bearer-token REST API must be able to call the exact same services.
- `app/api/[transport]/route.ts`: `createMcpHandler` (serverInfo name `shaughv-health-mcp`), basePath `/api` → endpoint `/api/mcp`; `withMcpAuth(handler, verifyToken, {required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource'})`; verifyToken validates better-auth-issued tokens via @better-auth/mcp API (current docs!); resolve app_user from authInfo; Node runtime; `maxDuration` ≥ 60.
- Read tools (`src/mcp/tools/`): get_today_steps (goal from settings if present; NEVER invent), get_sleep_summary (last_night|date), get_latest_heart_rate ("latest synced, not live" note), get_exercise_week, get_nutrition_log, get_health_context (fatigue|heart_rate|general bundle; data only, zero conclusions), query_health_data (registry allowlist; list|reconcile), rollup_health_data, get_sync_status.
- Resources (`src/mcp/resources/`): health://profile, health://settings, health://connected-user, health://data-types, health://freshness. Profile/settings/identity reads go through health_cache (TTL ~1h); ALL health-data tools fetch live.
- Every response: `freshness {retrievedAt, latestDataTime?, isPossiblyStale, note}` + units; pageSize cap ≤100; HR series summarized via rollups; truncation notes.
- Error shapes per handoff §21 verbatim (google_health_not_connected / missing_scope / reauth_required / rate_limited / empty-data).

## Impact
Health data becomes reachable by any authenticated MCP client. Payload discipline matters — an LLM must never receive 1,440 raw HR samples.

## Acceptance
MCP Inspector (`npx @modelcontextprotocol/inspector`) completes the OAuth dance locally, lists tools/resources, and every read tool returns sane bounded output against mocked-or-real data.

## Verification
- [x] Unauthenticated POST /api/mcp → 401 with WWW-Authenticate pointing at protected-resource metadata (verified dev + prod)
- [~] Inspector OAuth E2E (waived 2026-07-09 — agent: transport-level JSON-RPC initialize/list/call proven by spike test; full OAuth-dance E2E over prod HTTP is #p7d's battery, running next)
- [x] Each read tool returns freshness metadata + units — 11/11 live service checks vs real data (scripts/live-verify.ts): steps 1387, sleep 333min, HR 101/resting 77, 3 workouts, devices w/ battery
- [x] get_today_steps: no goal invented — goalNote explains the API has no goals surface; optional goalSteps input
- [x] query_health_data rejects non-allowlisted dataType (live-checked, unknown_data_type)
- [x] Payload bounds: pageSize hard-capped 100, arrays bounded with truncation notes, HR summarized
- [x] Vitest: zod schemas validate (spike test rejects bad args); 67/67 suite green

## Status
Not started — but BOTH pre-identified risks are now CLEARED and the endpoint skeleton is already live (2026-07-09, fable, at Emmett's direction before the Opus handoff):

**Risk 1 — OAuth consent step: RESOLVED, no consent page needed.** Source-read of better-auth 1.6.23's mcp plugin (`node_modules/better-auth/dist/plugins/mcp/authorize.mjs`): the plugin's own authorize handler auto-issues the code immediately after login unless the CLIENT sends `prompt=consent`; even then, with no consentPage configured it falls through to issuing the code; and the token endpoint never checks the stored requireConsent flag. Perfect for a private single-user server. Do NOT build a /consent page.

**Risk 2 — zod 4 + mcp-handler: RESOLVED, compatible.** Spike test (`tests/unit/mcp-handler-spike.test.ts`) drives the real `createMcpHandler` with raw JSON-RPC: initialize → tools/list (zod 4 shape converted to proper JSON Schema with the `echo` property) → tools/call (works) → invalid-arg call (rejected). No zod pin needed.

**Already landed (grow, don't rewrite):**
- `app/api/[transport]/route.ts` — the real endpoint: better-auth `withMcpAuth(auth, ...)` wrapping `createMcpHandler`, Node runtime, maxDuration 60, serverInfo `shaughv-health-mcp`. Verified: unauthenticated POST /api/mcp → 401 + `WWW-Authenticate: Bearer resource_metadata="…/api/auth/.well-known/oauth-protected-resource"`; metadata serves at BOTH that path and the root `/.well-known/*` routes.
- `src/mcp/register-tools.ts` — the registration seam with a permanent `ping` diagnostic tool (reports authenticated userId). Add the 9 read tools + resources here; handlers THIN over `src/health-services/` (see #api).
- MCP client refresh tokens now roll with a 60-DAY window (`refreshTokenExpiresIn` in auth.ts oidcConfig; plugin default was 7d; tokens re-issue on every refresh) — matches Emmett's "connect once, never re-auth" intent.

Note: `session` passed by withMcpAuth is the access-token record — `session.userId` is the better-auth user id; resolve the domain user via email lookup (`getOrCreateAppUser`/`getAppUserByEmail` need the EMAIL — fetch the better-auth user row by session.userId first, or add a helper).

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
- 2026-07-09 01:55 — pre-flight risk checks done at Emmett's direction: consent = none needed (source-verified), zod4/mcp-handler = compatible (spike test); endpoint skeleton + ping tool live, 401/WWW-Authenticate verified; refresh window 60d (agent: fable)
