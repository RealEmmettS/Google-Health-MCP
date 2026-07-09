TT;DR: Future idea from Emmett — expose the same health data as a plain REST API secured by bearer tokens he issues himself, so his own scripts and apps can make standard API calls without being MCP clients. Not scheduled; this task keeps the idea, the design sketch, and the one present-day prep note on the record.

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
