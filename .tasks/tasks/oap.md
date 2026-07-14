TT;DR: Replace the time-boxed Better Auth 1.6 legacy MCP compatibility bridge with the maintained OAuth Provider only through an explicit migration that preserves Google Health data and coordinates a one-time MCP connector re-auth.

## Why

Better Auth's built-in `mcp()` plugin is deprecated. The 0.1.2 incident repair keeps existing DCR registrations and opaque access/refresh tokens working while correcting its malformed OIDC response with persisted RS256 signing keys, PKCE, resource validation, JWKS, and UserInfo. It deliberately does not pretend the legacy token model is the durable endpoint: tokens are opaque legacy rows, and refresh re-issuance does not immediately invalidate the prior refresh token.

The maintained `@better-auth/oauth-provider` changes tables, endpoint contracts, consent handling, token hashing, and MCP bearer verification. A direct swap would invalidate existing Claude clients and requires Emmett and Christian to reconnect, so it must not be smuggled into an incident patch. The current [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) requires public-client refresh rotation; [RFC 9700 §4.14](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14) adds replay detection and token-family revocation expectations.

## Plan

1. Re-verify the then-current Better Auth and MCP authorization documentation; prefer a stable release containing full authorization-grant resource binding.
2. Build additive provider/JWKS tables and a real consent/login-resume path without touching `app_users`, Google Health connections, or encrypted Google tokens.
3. Configure DCR, form-encoded token exchange, exact issuer, one valid audience (`https://health.emmetts.dev/api/mcp`), and exact audience verification at the MCP handler.
4. Exercise public/confidential clients plus negative PKCE/resource/redirect tests and real Claude web/Desktop/Code compatibility in a non-production cutover rehearsal.
5. Schedule a connector re-auth window for both allowlisted users, retain legacy OAuth tables only for a short rollback period, then revoke and remove the compatibility bridge.

## Verification

- [ ] Current stable provider version and open security advisories are documented
- [ ] Authorization grant, token, and refresh are bound to the one canonical resource/audience
- [ ] Public and confidential DCR + PKCE paths pass with form-encoded token exchange
- [ ] Public refresh-token rotation atomically invalidates the predecessor and rejects family replay
- [ ] Existing users and Google Health connections/tokens remain unchanged
- [ ] Emmett and Christian reconnect successfully across intended clients
- [ ] Legacy MCP registrations/tokens and the 0.1.2 bridge are retired after the rollback window

## Status

BACKLOG. The incident release must preserve existing clients; begin only as a deliberate migration with operator coordination.

## Activity

- 2026-07-13 — Created from the 0.1.2 OAuth incident review so the compatibility bridge remains explicitly time-boxed and the broader auth migration is not lost. (agent: codex)
- 2026-07-14 — A controlled public/confidential refresh replay proved the legacy plugin returns a fresh token pair but still accepts the predecessor again. Current clients can refresh, but this does not meet the current public-client rotation/replay contract. A response-wrapper delete would be non-atomic and would lose token-family lineage, so the durable fix stays in this coordinated provider migration. All probe rows were cleaned up. (agent: codex)
