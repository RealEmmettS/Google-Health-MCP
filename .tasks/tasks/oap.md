TT;DR: Replace the time-boxed Better Auth MCP bridge with stable `better-auth` and `@better-auth/oauth-provider` 1.6.25, audience-bound RS256 JWTs, hashed rotating refresh tokens, additive storage, and Google Health refresh-token DPoP without risking the working Google connection.

## Why

Better Auth's built-in `mcp()` plugin is deprecated. The 0.1.2 incident repair keeps existing DCR registrations and opaque access/refresh tokens working while correcting its malformed OIDC response with persisted RS256 signing keys, PKCE, resource validation, JWKS, and UserInfo. It deliberately does not pretend the legacy token model is the durable endpoint: tokens are opaque legacy rows, and refresh re-issuance does not immediately invalidate the prior refresh token.

The maintained `@better-auth/oauth-provider` changes tables, endpoint contracts, consent handling, token hashing, and MCP bearer verification. A direct swap invalidates current connector registrations, so the migration follows the independently deployable SDK checkpoint and retains untouched legacy tables for seven days. The service is now Emmett-only; Google Sign-In remains identity for authorization, while Google Health consent and encrypted refresh credentials remain a separate upstream flow.

The 2026 MCP authorization contract requires exact issuer/resource/audience handling and forbids accepting or forwarding upstream Google tokens. Stable Better Auth 1.6.25 provides production OAuth Provider/JWT/DCR/PKCE support; CIMD remains deliberately deferred until a stable maintained implementation exists rather than being hand-rolled.

## Scope

Stable exact provider versions, OAuth endpoints under `/api/auth/oauth2/*`, root authorization/OpenID metadata, canonical and legacy protected-resource aliases, persisted environment-specific RS256 JWKS, public DCR normalized to S256, form-encoded tokens, branded consent, health read/write scopes, one-hour JWT access tokens verified locally, hashed rotating 60-day refresh tokens, email/allowlist claims, additive provider tables, database global rate limiting, and one P-256 DPoP key per Google Health connection. No Better Auth 1.7 prerelease, beta CIMD, Google-token passthrough, public signup, or destructive legacy cleanup before soak acceptance.

## Plan

1. Pin the verified stable 1.6.25 provider line and map its models to separate `mcp_oauth_*_v2` tables plus the existing environment-specific JWKS model.
2. Implement consent/login resume, canonical metadata aliases, public S256 DCR, exact resource binding, form-encoded exchange, health scopes, rate limits, and local cached JWKS verification.
3. Issue one-hour audience-bound JWT access tokens with email and no persisted token value; enforce issuer, audience, subject, expiry, scope, and current environment allowlist at the resource server.
4. Add encrypted Google DPoP key storage and proof/nonce/retry logic. Replace the working refresh token only after explicit prompt-consent exchange succeeds atomically.
5. Rehearse additive migration and rollback without a paid database branch, then deploy only after the 0.2.1 connector checkpoint passes.
6. Reconnect Emmett's active clients once; retain legacy tables seven days and remove them only after the integrated `#q2` gate.

## Impact

MCP authorization URLs move from `/api/auth/mcp/*` to `/api/auth/oauth2/*`, requiring a one-time connector reconnect. Per-request bearer verification no longer performs a Neon auth lookup. Account-wide removal remains immediate through `ALLOWED_GOOGLE_EMAILS`; a client-specific JWT revocation can lag by at most the one-hour access-token lifetime, while emergency signing-key rotation invalidates every access JWT.

## Acceptance

**Functional bar:** public connector DCR, consent, authorization, exchange, refresh rotation, UserInfo, JWKS, and scoped MCP access work with the canonical issuer/resource and current allowlist.

**Security bar:** wrong issuer/audience/resource/scope/email and token passthrough fail; secrets, codes, health payloads, and DPoP keys never enter logs/errors; Google token replacement is atomic and preserves the prior token on any failure.

**Migration bar:** existing users, Google connections, caches, webhook records, and audit history are unchanged; old MCP OAuth tables remain rollback-only until `#q2` closes.

## Verification

- [ ] Exact stable Better Auth/provider version and open security advisories are documented
- [ ] Authorization grant, token, and refresh are bound to the one canonical resource/audience
- [ ] Public and confidential DCR + PKCE paths pass with form-encoded token exchange
- [ ] Public refresh-token rotation atomically invalidates the predecessor and rejects family replay
- [ ] Missing/expired/wrong issuer, audience, resource, scope, subject, email, malformed, and passthrough tokens fail
- [ ] JWT access verification performs no Neon token lookup and rechecks the current allowlist locally
- [ ] Consent denial, endpoint rate limits, UserInfo, JWKS cache, and metadata aliases pass
- [ ] Existing users and Google Health connections/tokens remain unchanged
- [ ] DPoP proof, nonce retry, key mismatch, and atomic replacement/preservation tests pass
- [ ] Emmett reconnects successfully across every intended client
- [ ] Legacy MCP registrations/tokens and the 0.1.2 bridge are retired after the rollback window

## Status

ACTIVE. Emmett explicitly authorized the coordinated migration as the second checkpoint of `#mcp2`. Implementation follows the production-qualified 0.2.1 transport artifact; no auth schema or production auth mutation has occurred yet.

## Activity

- 2026-07-13 — Created from the 0.1.2 OAuth incident review so the compatibility bridge remains explicitly time-boxed and the broader auth migration is not lost. (agent: codex)
- 2026-07-14 — A controlled public/confidential refresh replay proved the legacy plugin returns a fresh token pair but still accepts the predecessor again. Current clients can refresh, but this does not meet the current public-client rotation/replay contract. A response-wrapper delete would be non-atomic and would lose token-family lineage, so the durable fix stays in this coordinated provider migration. All probe rows were cleaned up. (agent: codex)
- 2026-07-29 01:45 - Moved Backlog to Active under `#mcp2`; updated the contract for stable 1.6.25 JWT/DCR/consent support, Emmett-only reconnects, additive tables, local allowlist verification, and Google Health DPoP with atomic fallback. (agent: codex)
