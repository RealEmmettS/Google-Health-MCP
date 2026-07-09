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
- [ ] Unauthenticated POST /api/mcp → 401 with WWW-Authenticate pointing at protected-resource metadata
- [ ] Inspector: OAuth flow completes; tools+resources discoverable; schemas render
- [ ] Each read tool returns freshness metadata + units (spot-check all 9)
- [ ] get_today_steps with no goal available says goal unknown (does not invent)
- [ ] query_health_data rejects non-allowlisted dataType with clear error
- [ ] Payload bound: >100-point range returns capped output + truncation note
- [ ] Vitest: tool schema validation (bad inputs rejected by Zod)

## Status
Not started. Prereq: #p4g.

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
