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

- [x] Exact stable Better Auth/provider version and open security advisories are documented
- [x] Authorization grant, token, and refresh are bound to the one canonical resource/audience
- [x] Public DCR persists only in v2 tables, requires S256 PKCE, and the token boundary requires form encoding
- [x] Stable refresh rotation behavior is characterized: predecessor CAS + sequential replay rejection; the non-atomic successor/family concurrency residual is explicitly accepted and tracked
- [x] Missing/expired/wrong issuer, audience, resource, scope, subject, email, malformed, and passthrough tokens fail
- [x] JWT access verification performs no Neon token lookup and rechecks the current allowlist locally
- [x] Production DCR, exact resource, form token boundary, RS256 JWKS, metadata aliases, 401/403, and no-store gates pass
- [x] MCP server identity/icon and per-tool OAuth metadata pass modern and legacy client conformance
- [x] ChatGPT's working connector auth is distinguished from its personal-plugin bundle install state
- [x] Codex silently rotates after access-token expiry with the guarded default resource, then pings and performs a non-mutating read without manual sign-in
- [x] The 24-hour auth rollout watch passes with canonical six-scope discovery/challenge, modern and legacy traffic, and no server regression
- [ ] Signed-in consent denial, UserInfo/JWT use, JWKS warm-cache, refresh, and endpoint limit thresholds pass during reconnect
- [x] Existing users and Google Health connections/tokens remain unchanged in apply/rollback rehearsal
- [x] DPoP proof, nonce retry, key mismatch, atomic preservation, and forced reconnect/refresh race tests pass
- [ ] Emmett reconnects successfully across every intended client
- [ ] Legacy MCP registrations/tokens and the 0.1.2 bridge are retired after the rollback window

## Status

ACTIVE. Exact stable 1.6.25, migrations 0004–0007, and the 2026-07-31 desktop refresh-compatibility
patch are live in production. Protected-resource/401 scope fallback, all-six-scope authorization
metadata, public DCR, S256, refresh grant, exact resource, and callback-profile gates pass. The
ChatGPT MCP connector has a current registration, consent, refresh credential, and successful tool
traffic; its separate personal-plugin bundle still displays an install action in ChatGPT-managed UI.
Existing affected clients still need one ordinary reauthentication to mint a refresh credential;
signed-in consent redirect, UserInfo/JWT, Google reconsent, and soak gates remain open. Google
reconsent and destructive cleanup require fresh approval.

The durable-auth repair remains live; its 24-hour watched production artifact was
`dpl_4KvquU7U2KRnGVPm1prnhyeHGkf7` from `e7f7c1a`. Production defaults an omitted refresh resource
only in the guarded single-resource case, advertises the six-scope grant consistently, and emits
allowlisted privacy-safe telemetry. Codex silently rotated after expiry with
`resourceDisposition=defaulted`, then passed ping and a non-mutating read without manual sign-in;
modern traffic also rotated with `resourceDisposition=exact`. The 24-hour watch passed. Remaining
client surfaces, Google reconsent/DPoP, the seven-day watch, and cleanup remain open.

## Activity

- 2026-07-13 — Created from the 0.1.2 OAuth incident review so the compatibility bridge remains explicitly time-boxed and the broader auth migration is not lost. (agent: codex)
- 2026-07-14 — A controlled public/confidential refresh replay proved the legacy plugin returns a fresh token pair but still accepts the predecessor again. Current clients can refresh, but this does not meet the current public-client rotation/replay contract. A response-wrapper delete would be non-atomic and would lose token-family lineage, so the durable fix stays in this coordinated provider migration. All probe rows were cleaned up. (agent: codex)
- 2026-07-29 01:45 - Moved Backlog to Active under `#mcp2`; updated the contract for stable 1.6.25 JWT/DCR/consent support, Emmett-only reconnects, additive tables, local allowlist verification, and Google Health DPoP with atomic fallback. (agent: codex)
- 2026-07-29 03:58 - Replaced the legacy provider bridge with stable Provider/JWT, exact
  resource/audience and no-store boundaries, public S256 DCR, explicit consent, local allowlist
  JWT verification, and isolated v2 models. Recorded GHSA-p2fr-6hmx-4528 containment, the stable
  provider refresh-family concurrency limitation, and trusted-environment table sharing rather
  than claiming stronger guarantees. (agent: codex)
- 2026-07-29 03:58 - Added encrypted per-connection Google DPoP, nonce retry, DB-clock single
  flight, row-local credential generations, and a five-second post-commit identity timeout.
  Isolated Neon passed 5/5 atomic/race/failure tests; provider DCR passed 2/2 and all rehearsal
  rows/branches were removed. Aggregate legacy/Google counts were unchanged. (agent: codex)
- 2026-07-29 04:25 - Deployed commit `0dda866` as production
  `dpl_5h11asJsx4hRJkrebvANHqRrkdTZ` in `iad1`. Canonical auth/OpenID/protected-resource metadata,
  one RS256 JWKS key, public native DCR 201 with no secret, wrong-resource 400, JSON-token 415,
  form-token `invalid_grant`, scoped 401, wrong-Origin 403, oversized 413, and no-store responses
  passed. The exact synthetic client was removed; v2 token/consent rows remain zero, DPoP remains
  unactivated, and Vercel reported no runtime errors. (agent: codex)
- 2026-07-31 00:56 - Correlated Hermes' successful `127.0.0.1` callback and one-hour access JWT
  with a missing refresh token. Current desktop clients can prioritize challenge/protected-resource
  scopes and omit `offline_access`; stable Better Auth then correctly withholds refresh issuance.
  Removed optional initial scope narrowing, retained explicit write-scope 403 step-up, added exact
  Hermes/Claude Code/Codex callback profiles, and applied data-only migration `0007`. It expanded
  exactly two active public registrations; all five now allow the six-scope request, while five
  refresh rows, two consent rows, zero access-token rows, and the one Google credential row were
  untouched. The real provider integration, 149 tests, typecheck, and build pass. (agent: codex)
- 2026-07-31 01:05 - Commit `b3ff5c0` deployed READY as
  `dpl_BXX6gM9UXVP7yRsNHMKEdnGzVXAR` with three Node functions in `iad1` and the production alias.
  Live metadata/401 checks proved no resource-scope narrowing and all six authorization scopes;
  public native DCR proved S256, refresh grant, no secret, and all scopes. Its one synthetic client
  row was deleted, leaving five real clients, and Vercel reported no runtime errors. (agent: codex)
- 2026-07-31 01:52 - Audited ChatGPT without mutating connector state. The live provider has one
  ChatGPT client with the modern callback, all six scopes, one active refresh credential, one
  consent, and no duplicate/legacy callback; Vercel logs show authenticated list/call traffic with
  no 5xx. OpenAI's current docs and the live UI distinguish the working MCP connector from the
  separately installed personal-plugin bundle, explaining why chats work while its bundle detail
  still says `Install plugin`. Added SDK-native server title/description/site/icon metadata,
  protected-resource documentation, and per-tool OAuth scope metadata; both protocol eras pass the
  official v2 client conformance tests. No client, token, consent, or database row changed.
  (agent: codex)
- 2026-07-31 02:04 - Commit `a41f4c4` deployed READY as
  `dpl_74z3BNq9bU9tJcZyiJtSftMhDs3x` with three Node functions in `iad1`. Canonical protected-resource
  metadata now advertises the documentation URL, the existing Codex MCP connection completed an
  authenticated production `ping`, and the 401 challenge remains exact and no-store. Reopening the
  ChatGPT personal-plugin detail still showed `Install plugin`, confirming that ChatGPT did not
  derive or update that separate bundle-install flag from the healthy MCP connector deployment.
  No install, disconnect, registration, token, consent, or database mutation was attempted.
  (agent: codex)
- 2026-08-03 - Implemented and locally qualified the durable-auth candidate. Authorization and
  code exchange remain exact; refresh alone may insert the canonical resource in the guarded
  single-resource case, while blank/wrong/duplicate values fail. Protected-resource metadata and
  the initial 401 now advertise all six approved scopes; 403 remains operation-specific. The full
  suite passed 153 with 7 skipped, typecheck/build passed, and the corrected v2 E2E passed hosted,
  Claude Code, and Codex public DCR/PKCE/consent/JWT/UserInfo/MCP/rotation. Codex-shaped omitted-
  resource refresh logged `defaulted`; exact clients logged `exact`; Inspector listed 18 tools;
  cleanup verified zero synthetic v2 rows. Production and real-client gates remain open.
  (agent: codex)
- 2026-08-04 - Pushed the durable-auth repair and Codex RFC 9207 callback-relay workaround to
  `main`. Production deployment `dpl_4KfVgFviFrMgWFH2QYXfhAGC63Pz` is READY at the canonical
  alias from `b4a9d0e`; live authorization/OpenID metadata expose six scopes and disable strict
  response-issuer validation while Better Auth continues emitting exact `iss`. Codex 0.146.0
  completed fresh DCR/PKCE/consent/exchange and a separate CLI read, with one active six-scope
  rotating credential. Claude Code's plugin connector also completed real OAuth and owns one
  active six-scope rotating credential. One-hour, remaining-client, soak, DPoP, and cleanup gates
  remain open. (agent: codex)
- 2026-08-05 - Accepted the 24-hour durable-auth watch. Final production deployment
  `dpl_4KvquU7U2KRnGVPm1prnhyeHGkf7` remained READY at the canonical alias; hourly health,
  OAuth/OIDC/protected-resource/JWKS and six-scope 401 checks passed. Post-expiry Codex refresh
  telemetry was `refresh_token`/`defaulted`/200/none and required no sign-in; ping and a
  non-mutating read passed. Compliant modern traffic showed `exact` refresh and successful
  read-only calls. There were no `invalid_target`, error, fatal, 5xx, or token-loop regressions.
  One isolated `invalid_grant` from an obsolete client registration did not match any current v2
  client and never retried. No client credential or health value was changed or recorded.
  (agent: codex)
