TT;DR: Replace `mcp-handler` and the monolithic v1 SDK with the official MCP SDK v2 handler, preserve stateless 2025 compatibility, strengthen the HTTP boundary, and ship it first as 0.2.1 on Vercel Fluid in `iad1`.

## Why

The modern protocol is request-scoped and sessionless, which matches Vercel Functions. A transport-only checkpoint isolates protocol/runtime risk from the later authorization migration and leaves the currently proven OAuth stack available for immediate rollback.

## Scope

Official `@modelcontextprotocol/server@2.0.0`, matching conformance client, one server factory per request, modern discovery plus stateless legacy initialize/list/call, deterministic tool/resource registration, typed input/output schemas and structured results, annotations, cache hints, Host/Origin/body validation, no-store health responses, privacy-safe telemetry, Node 24, 60-second MCP duration, Fluid Compute, and `iad1`. No OAuth provider cutover, Tasks, MRTR, subscriptions, or Edge migration.

## Plan

1. Capture the clean source/production/schema/latency baseline and publish the dated research/hosting ADR.
2. Replace dependencies and transport wiring against the exact stable v2 API.
3. Adapt all tools/resources without changing names, URIs, argument meaning, or JSON-text fallback.
4. Add modern, legacy, contract, transport-boundary, cache, telemetry, and cancellation tests.
5. Run the full local gates, commit/push 0.2.1, deploy, and qualify modern plus active legacy connectors before authorizing the auth checkpoint.

## Impact

The public `/api/mcp` URL remains stable. Modern clients gain the 2026 envelope and structured contracts; older connectors keep stateless legacy calls. The main risk is client protocol drift, bounded by the standalone release and existing Vercel rollback artifact.

## Acceptance

**Functional bar:** modern v2 discovery/list/read/call and current stateless legacy initialize/list/read/call all work at the canonical production URL.

**Evidence bar:** automated protocol/security contracts, clean typecheck/build, production-safe probes, a v2 client, and every active legacy connector.

**Valid bounded outcomes:** PASS and proceed to `#oap`; rollback to 0.2.0; or pause on a named connector incompatibility.

## Evidence

| Criterion | Oracle / invocation | Result | Status |
|---|---|---|---|
| Starting source baseline | `git status`; existing test/type/build gates | `main` clean and synchronized; prior 114/114, typecheck, build green | PASS |
| Board/runtime baseline | task board identity; Vercel/Neon inspection | board 1.1.1 at repo-local port 4318; production Node functions and Neon both `iad1`/us-east | PASS |
| Transport implementation | official v2 client; full source gates | modern + stateless legacy, 18 annotated/schema-complete tools, structured results, 6 cache-hinted resources, HTTP boundary; 126/126 tests, typecheck and build green | PASS |
| Production 0.2.1 qualification | Pending | Pending | OPEN |

## Verification

- [x] Stable SDK v2 server/client versions are pinned and legacy wrappers are removed
- [x] Modern discovery, JSON/SSE, metadata, cancellation, result type, and cache behavior pass
- [x] Stateless legacy initialize, list, resource read, and tool call pass without `Mcp-Session-Id`
- [x] Every tool has title, annotations, object input schema, output schema, and matching structured content
- [x] Host, Origin, transport metadata, 256 KiB body, no-store, and safe-telemetry tests pass
- [x] `npm test`, typecheck, production build, and dependency/security checks pass
- [ ] Production 0.2.1 passes v2 client and all active connector smoke tests with bounded latency

## Status

ACTIVE. The 0.2.1 source artifact is green and ready for commit/deployment. The legacy compatibility bridge still performs its required token-table and allowlist lookups; the zero-Neon-auth-query gate belongs to the 0.3.0 JWT checkpoint, not this deliberately auth-preserving release.

## Activity

- 2026-07-29 01:45 - Created as the first independently revertible checkpoint of `#mcp2`; recorded the clean baseline and compatibility-first release boundary. (agent: codex)
- 2026-07-29 02:12 - Replaced `mcp-handler`/monolithic SDK with exact official server/client 2.0.0, added the request-scoped factory, stateless legacy fallback, typed structured tools/resources, cache policy, streamed body cap, exact Host/Origin policy, and safe telemetry. Full suite is 126/126; typecheck and production build pass. `npm audit --omit=dev --audit-level=high` reports no production vulnerability; four moderate findings remain in the development-only Drizzle CLI chain and the offered fix is breaking. (agent: codex)
- 2026-07-29 02:15 - Added focused official-client proofs for `server/discover`, modern JSON, request-scoped SSE auto-upgrade, result projection, cache hints, header/body mismatch rejection, response-stream cancellation, and legacy sessionless operation. (agent: codex)
