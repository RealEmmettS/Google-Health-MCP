TT;DR: The work-computer attempt completed Google sign-in and persisted MCP tokens, but a replay proved the legacy Better Auth path then returned an unverifiable OIDC response. Ship a narrow RS256 compatibility release, document a safe connector reset, and keep this task Active until the real work workspace succeeds or yields an Anthropic support trace.

## Why

The operator saw the Health sign-in page, clicked Google, returned immediately to Claude, and received an error. Read-only production evidence rules out a stale deployment, a health.emmetts.dev cache, and a pre-token Google failure:

- Production is healthy at `f04c7b4` with canonical OAuth metadata and the expected unauthenticated MCP challenge.
- The incident window created three Claude DCR applications using `https://claude.ai/api/mcp/auth_callback`.
- An allowlisted Edge browser session and two OAuth token rows were persisted immediately after two of those registrations; an existing Claude client also refreshed successfully in the same window.
- The skipped Google screen is consistent with Google silently reusing an existing browser login. The missing evidence is what Claude did after the token response; incident-time Vercel request logs had already expired.
- The strengthened local replay found a server-owned failure at that exact boundary: the deprecated built-in Better Auth MCP plugin emitted an ephemeral `HS256` ID token while discovery promised `RS256`, omitted `iss`, used millisecond `auth_time`, and advertised JWKS/UserInfo endpoints that returned 404. A strict Claude client can reject that token response before sending Bearer MCP traffic.
- Anthropic reports closely matching Windows token-binding/persistence and `ofid_*` failures in `anthropics/claude-code#52565` and `anthropics/claude-ai-mcp#207`; they remain relevant only if a valid 0.1.2 token response is followed by no Bearer request.

An apparent immediate-expiry theory was falsified: the database stores Better Auth timestamps without timezone metadata, and the local Windows driver rendered UTC wall times as local time. Raw values and successful refresh history show the incident tokens had normal one-hour access lifetimes. Do not migrate timestamps as part of this task.

## Plan

1. Extend `scripts/live-verify-e2e.ts` around the existing auth stack:
   - preserve the existing confidential `client_secret_post` flow;
   - add a public `token_endpoint_auth_method=none` + PKCE flow;
   - assert optional RFC 7591 response fields are omitted rather than `null`;
   - assert access/refresh token response shape and immediate Bearer MCP initialize/tools-list;
   - verify a signed-out authorize redirect preserves every OAuth parameter through `/sign-in`;
   - clean every test-created session, token, consent, and DCR application even on failure.
2. Add a README troubleshooting entry for silent Google SSO, account-level remote connectors, Team/Enterprise Owner setup, safe `/mcp` authentication clearing, and the callback-URL fallback for direct Claude Code connections.
3. Repair the proven compatibility defect without invalidating existing clients: enforce S256 PKCE, reject non-canonical supplied resources, sign replacement ID tokens with a persisted encrypted RS256 key, and serve working JWKS/UserInfo endpoints. Track the maintained OAuth Provider migration separately in `#oap`.
4. Run the complete local verification suite and production-safe metadata/401 checks. Run mutating OAuth E2E only with explicit cleanup and confirm no test rows remain.
5. Operator retry: update/quit Claude clients, select the intended Claude workspace, remove the failed remote connector once, clear only a duplicate direct Claude Code Health credential if present, re-add the canonical URL once, and test web before Desktop/Code.
6. Correlate the retry live. If a cryptographically valid token response completes without a Bearer MCP request, capture the exact Claude error/reference, versions, workspace type, and sanitized status for Anthropic.

## Verification

- [x] Signed-out authorize redirects to `/sign-in` with response type, client id, redirect URI, scope, state, PKCE challenge/method, and resource unchanged
- [x] Confidential-client DCR → authorize → form-token → immediate Bearer initialize/tools-list passes
- [x] Public-client DCR (`none`) → authorize → form-token without secret → immediate Bearer initialize/tools-list passes
- [x] Exact hosted Claude callback, Claude Code `localhost`, and Codex `127.0.0.1` callback-with-path profiles pass
- [x] Public/confidential refresh grants return fresh token pairs and the refreshed Bearer immediately initializes MCP and lists tools
- [x] DCR optional RFC fields are absent rather than `null`; token response includes bearer type, positive expiry, access token, and refresh token
- [x] ID tokens verify as RS256 against the advertised JWKS with issuer, audience, subject, nonce, and NumericDate claims intact
- [x] Missing PKCE and a non-canonical resource are rejected before the authorization code is consumed
- [x] JWKS and scoped UserInfo endpoints resolve; signing private keys remain encrypted at rest in environment-specific key rings
- [x] E2E cleanup runs on success and failure; no test session/application/token/consent rows remain
- [x] `npm test`, `npm run typecheck`, and `npm run build` pass
- [x] Production metadata and unauthenticated MCP 401 + exposed `WWW-Authenticate` remain correct
- [x] Fresh native Codex login completes DCR/PKCE/loopback callback and a read-only production tool call
- [x] Fresh direct Claude Code login completes DCR/PKCE/loopback callback and a read-only production ping; account connector is also connected
- [ ] One read-only Health tool succeeds from the intended work Claude workspace (owner emmett)
- [ ] The same remote connector is usable from Claude Desktop and Claude Code (owner emmett)

## Status

ACTIVE. The regression-proven server defect is fixed and 0.1.2 is live. Production health, OAuth/OIDC/protected-resource discovery, public-only RS256 JWKS, encrypted production key storage, wrong-resource rejection, and the unauthenticated MCP challenge all pass. Emmett still owns the real work-computer reconnect and cross-surface acceptance, so this task remains Active until that succeeds or produces an Anthropic trace.

## Activity

- 2026-07-13 — Read-only investigation correlated production deployment, OAuth metadata, DCR applications, browser session creation, token persistence, and refresh history. Closest explanation is Claude connector token handoff/persistence or workspace policy; no runtime changes or token revocations made. Timestamp-expiry hypothesis tested and rejected. (agent: codex)
- 2026-07-13 — Created task, moved it directly to Active, and opened the existing live board at this repo's resolved port 4321. (agent: codex)
- 2026-07-13 — Added confidential + public DCR/PKCE replay paths. Both reached token issuance and immediate Bearer MCP successfully, while seven OIDC assertions failed: HS256 contradicted RS256 discovery, `iss`/`auth_time` were invalid, and advertised JWKS/UserInfo returned 404. This converted the incident from a client-only hypothesis to a regression-proven server compatibility defect. (agent: codex)
- 2026-07-13 — Implemented the narrow bridge: required S256 PKCE, canonical-resource validation, persisted encrypted RS256 signing keys split by Development/Preview/Production secret domain, repaired ID-token claims, and real JWKS/UserInfo routes. Added unit coverage and additive migration `0002`; tracked the full provider migration separately as `#oap`. (agent: codex)
- 2026-07-13 — Security re-review closed mixed-case/suffix media-type bypasses, oversized-body/RSA-preflight abuse, exact-route matching, false `auth_time`/ACR metadata, missing OIDC discovery, and accidental dependency drift by pinning Better Auth 1.6.23. Migration `0002` was applied before code deployment. Final local gates: 82/82 unit tests, typecheck, production build, both confidential/public OAuth scenarios, live read-only steps, and zero cleanup rows all pass. Security finding outcome: fixed; legacy refresh/resource-token model debt remains explicitly in `#oap`. (agent: codex)
- 2026-07-13 — Pushed `127b9b2`; Vercel production deployment `dpl_5jbMwt44ta1iAvu6AzaxcJjE4Teq` became Ready and moved `health.emmetts.dev`. Safe production checks passed: health, RFC 8414 + OIDC discovery agreement, canonical protected-resource metadata, one public-only RSA/RS256 JWKS key, encrypted private-key envelope in Neon, exposed MCP 401 challenge, and wrong-resource rejection. Server release is complete; operator web/Desktop/Code acceptance remains open. (agent: codex)
- 2026-07-14 — Revalidated production with the native clients rather than a simulation alone. Codex completed fresh public DCR, S256 PKCE, a randomized `127.0.0.1` callback, token persistence, and a read-only Health tool. The account-level Claude connector was connected; a separate direct Claude Code entry completed fresh public DCR, a `localhost` callback, and a read-only ping. Correlated production logs showed each token followed by authenticated MCP traffic and no relevant 5xx/unexpected 4xx responses. The original 0.1.2 fix is working; the intended work-computer/workspace acceptance remains operator-owned. (agent: codex)
- 2026-07-14 — Corrected the verifier's client profiles to use Claude's exact hosted callback plus both loopback host shapes, and added public/confidential refresh grants with immediate post-refresh MCP use. That exposed one unrelated RFC 6749 gap: legacy refresh responses omitted no-store/no-cache. The narrow 0.1.3 response-header fix passes 83 unit tests, typecheck, build, and the full three-profile local OAuth E2E with zero cleanup rows. Legacy refresh-token replay remains separate, explicitly recorded migration debt in `#oap`. (agent: codex)
