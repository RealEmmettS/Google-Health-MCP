TT;DR: Future idea from Emmett — expose the same health data as a plain REST API secured by bearer tokens he issues himself, so his own scripts and apps can make standard API calls without being MCP clients. Not scheduled; this task keeps the idea, the design sketch, and the one present-day prep note on the record.

## Feasibility on current Vercel deployment (Opus analysis, 2026-07-09)
**Verdict:** FEASIBLE — a stateless PAT-authenticated REST surface is the *easy* case for Vercel serverless (strictly simpler than the OAuth/DCR MCP surface already running), and it slots cleanly next to the existing routes with only additive work; no platform, tier, or architectural blocker exists.

**Architectural fit — zero impedance.** REST + static bearer token is the canonical serverless-function shape: request in → verify token (one indexed DB read via the existing `@neondatabase/serverless` HTTP driver) → call service → JSON out. It is *less* demanding than the MCP transport, which carries streamable-HTTP framing, `withMcpAuth`, OAuth 2.1 token verification, and DCR. No long-lived connections, no SSE, no state between requests — nothing the current stack doesn't already do on the MCP path. Node runtime (already mandated for `node:crypto` + DB) covers it. One shared constraint carries over unchanged: nothing survives the response, so writes must finish before returning (fine — REST writes are synchronous by design).

**PAT mechanism — recommend the better-auth `apiKey` plugin, with one packaging caveat.** It delivers *every* item on this task's own acceptance list out of the box: SHA-256 key hashing (`disableKeyHashing` off by default), revocation (`enabled` flag), scopes (`permissions`), last-used (`lastRequest`), `expiresAt`, plus free per-key rate limiting — versus hand-writing and testing all of that. Per-request verification is `auth.api.verifyApiKey({ body: { key, permissions } })`: a server-side hashed-lookup that runs per-invocation in a serverless function with no issue (same stateless neon-http access pattern used everywhere here; no pooling/connection concern). It adds **one table, `apikey`** (id, `key` = hash, `start`/`prefix` for UI display, `referenceId` = owner, `enabled`, `expiresAt`, `permissions`, `metadata`, rate-limit + refill counters, timestamps).
- **Caveat (verified against installed tree):** in better-auth 1.6.23 the plugin is **not bundled** — it has moved to a separate package `@better-auth/api-key` (not in `package.json`; confirmed absent from the `better-auth/plugins` barrel, which exports `mcp`/`bearer`/`jwt` but not `apiKey`). Adoption = add that one dependency + run better-auth CLI codegen for the `apikey` table. Pin the version: the split also renamed `userId`→`referenceId` and added `configId`.
- **Header nuance:** the plugin defaults to the `x-api-key` header, and `Authorization: Bearer` is already claimed by the MCP OAuth path. Cleanest integration: in the REST route, extract the token yourself (accept `Authorization: Bearer` *or* `x-api-key`) and pass the raw string to `verifyApiKey({ body: { key } })` — sidesteps header wiring entirely and keeps the design-sketch's Bearer scheme.
- **Ownership hop:** keys bind to the better-auth `user`; this app's domain is keyed on `app_users` (linked by email). That's the *same* one-hop resolution the MCP tools already do (`src/auth/app-user.ts`) — reuse it, not a new problem.
- **Hand-rolled is a legitimate fallback** (an `api_tokens` table + reuse of the existing SHA-256 discipline already used for `oauth_states.stateHash` + `src/security/`), and avoids the new dependency. Choose it only if dependency-minimalism outweighs getting rate-limiting/scopes/expiry/last-used for free. Net recommendation: **`apiKey` plugin** — the feature match to the acceptance criteria is decisive and it's idiomatic for an existing better-auth shop.

**Tier limits — Hobby is sufficient by a wide margin.** Each REST read = 1 function invocation + 1–3 Google Health fetches (sub-second to a few seconds each) + a couple of Neon queries; well under the 60s Fluid-compute duration cap (the MCP route already plans `maxDuration ≥60s`; REST reads need far less). A few hundred calls/day (~9k/month) of KB-scale JSON is a rounding error against Hobby's included invocations and 100 GB fast-data-transfer. Google's 300 req/min/user quota and Neon free-tier compute-hours are both non-issues at single-user scale. The *only* real tier consideration is policy, not capacity: Hobby is non-commercial personal use — a private health API for one's own scripts is squarely compliant.

**Security posture — one open production domain, so the token is the whole perimeter.** Deployment Protection stays preview-only (production must stay open for programmatic clients — same posture the MCP endpoint already requires); no conflict. Requirements: (1) high-entropy tokens (≥32 random bytes) stored **hashed only** — the plugin does both; (2) rate limiting / brute-force defense on the open endpoint. **Recommendation: app-level rate limiting** — the `apiKey` plugin's built-in per-key `rateLimit` (e.g. N req/day) is free, plan-independent, and per-token; enable it. Vercel WAF/`@vercel/firewall` `checkRateLimit` + custom `rate_limit` rules exist as an IP-level upgrade path but rate-limiting rules are effectively a Pro feature — not needed at this scale. Constant-time compare is inherent to hashed lookup. Return `401` (no/invalid/revoked token) and `403` (valid token, wrong scope); never leak which failed. Keep write audit-logging (`mutation_audit_log`) on the REST path exactly as the MCP tools do.

**Integration seams — clean, additive, no collisions.** New routes live under `app/api/v1/**`; existing surfaces are `app/api/auth/[...all]` (better-auth), `app/.well-known/*`, `app/api/health/status`, and the reserved MCP route `app/api/[transport]/route.ts` (→ `/api/mcp`). A static `v1` segment is a sibling of the dynamic `[transport]` (single-segment) and of `auth`/`health` — static wins, and `[transport]` only matches one path level, so `/api/v1/...` cannot collide. **No `middleware.ts` exists** today; prefer per-route guards over adding global middleware (keeps the MCP/auth paths untouched). Adding `apiKey` to the shared `auth` instance registers key-management endpoints under the `/api/auth/*` catch-all (session-guarded, for the issuance/revocation UI) and is independent of `withMcpAuth`. The planned `src/health-services/` shared layer **is** the right seam and the load-bearing prerequisite: once MCP handlers are thin wrappers over those service functions (the Phase 5 prep note), the REST surface is routing + PAT middleware + response formatting, not a rewrite. Today only `src/google-health/` exists (client/registry/errors) — the service layer is still to be factored.

**Estimated cost — $0 incremental.** Stays within Hobby free tier and Neon free tier at a few-hundred-calls/day; no new paid service required. (Only a sustained, orders-of-magnitude traffic increase — not a single-user scenario — would push toward Pro, and rate limiting caps that anyway.)

**What would change this verdict:**
- Emmett wants IP-level/edge rate limiting or managed WAF rate rules on the open domain → likely needs Vercel **Pro** (verdict → FEASIBLE WITH CAVEATS on cost).
- The deployment migrates to **Railway** (backlog #rlw) → re-evaluate; PAT-over-REST is *easier* on a long-running host, but auth wiring (better-auth vs FastMCP) reopens.
- Phase 5 ships MCP handlers with orchestration inline (not factored into `src/health-services/`) → REST becomes a partial rewrite; feasibility holds but effort rises materially.
- Multi-user or any non-personal/commercial use → Hobby policy no longer applies; needs a paid plan.
- A future need for streaming/very-long responses (>60s) → would need Pro's higher duration cap (not anticipated for these reads).

## Why
Direct operator idea (2026-07-09): "At some point, I may want to enable a custom API to call all of this information, connected specifically to my account. I need to handle authorization bearer tokens... so I can authorize myself and the clients that I build for it or connect to it, so my health data isn't just available to everybody. So I can make standard API calls as well as connect the MCP."

Translation into architecture: a second *presentation layer* over the same domain services the MCP tools use. The MCP surface speaks OAuth 2.1 (interactive login, DCR — right for LLM clients); the REST surface would speak **static bearer tokens / personal access tokens (PATs)** — right for curl, cron scripts, home-lab dashboards, and apps Emmett writes, where an interactive OAuth dance is unwanted.

## Design sketch (v-future — refine when scheduled)
**Endpoints:** `/api/v1/*` mirroring the MCP tool surface, e.g.:
- `GET /api/v1/steps/today` · `GET /api/v1/sleep/last-night` · `GET /api/v1/heart-rate/latest`
- `GET /api/v1/query?dataType=...&start=...&end=...` (generic, registry-allowlisted)
- `POST /api/v1/nutrition-logs` / `PATCH` / `DELETE` (same write rules + audit as MCP tools)
JSON in/out, same freshness metadata + error shapes as the MCP tools (one contract, two transports).

**Auth — personal access tokens:**
- Tokens issued/revoked from the dashboard by a signed-in (allowlisted) user; shown once at creation.
- Stored HASHED (sha256) — never plaintext, same discipline as everything else in this repo.
- Each token: name/label, optional scopes (read-only vs read+write), created/last-used timestamps, revocation.
- Bound to the issuing app_user — a token can only ever reach ITS user's data; the allowlist model is unchanged (only allowlisted users exist to issue tokens).
- STRONG CANDIDATE: better-auth's `apiKey` plugin already provides exactly this (issuance, hashing, verification, metadata) on our existing better-auth instance — evaluate first before hand-rolling. If hand-rolled: `api_tokens` table (id, user_id, token_hash, label, scopes, created_at, last_used_at, revoked_at).
- Verification middleware: `Authorization: Bearer <token>` → hash → lookup → user context → same service call path as MCP tools.

**Explicitly NOT:** public/anonymous access of any kind; separate user systems; exposing Google tokens through the API.

## Present-day prep (the only part that matters before this is scheduled)
Phase 5 must keep MCP tool handlers THIN: parse/validate input → call a service function in `src/health-services/` (or similar) → format MCP response. All Google Health orchestration, range logic, freshness computation lives in the service layer. Then #api is mostly routing + PAT middleware, not a rewrite. (Note added to #p5m's plan.)

## Acceptance
Dormant until Emmett schedules it; then: PAT issuance UI + hashed storage + revocation, versioned REST endpoints over the shared services, parity with MCP tool outputs, audit logging on writes, negative tests (no token / revoked token / wrong scope → 401/403), README API docs.

## Status
Dormant idea. Not part of milestone #v1. Only live obligation: the Phase 5 service-layer factoring note.

## Activity
- 2026-07-09 01:30 — created from Emmett's idea; design sketch + Phase 5 prep note recorded (agent: fable)
- 2026-07-09 01:25 — feasibility analysis added (agent: opus-subagent, dispatched by fable at Emmett's request)
