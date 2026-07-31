# Changelog

All notable changes to shaughv-health-mcp. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.
The `.tasks/` board tracks in-flight work; this file records what shipped.

## [Unreleased]

## [1.0.0] — 2026-07-31

### Changed

- Promoted the private Google Health MCP from the 0.x rollout line to its first stable
  release after the SDK v2 transport, OAuth/JWT migration, production deployment, and
  accumulated real-client testing.
- The MCP implementation identity now reports `1.0.0`. The protocol dependency remains
  independently pinned to `@modelcontextprotocol/server@2.0.0`.

### Unchanged

- Tool names, resources, schemas, OAuth behavior, endpoint URLs, and health-data behavior are
  unchanged from 0.3.0.
- The existing SEP-973 server icon metadata continues to reference the same canonical
  `image/png` asset. Rendering remains a client capability.
- The 0.3.0 migration, cutover, rollback, and deployment receipts remain historical evidence;
  the separate Fitbit webhook, Google reconsent, connector, soak, and legacy-cleanup gates stay
  open on the task board.

## [0.3.0] — 2026-07-29

### Added

- Stable Better Auth OAuth Provider endpoints under `/api/auth/oauth2/*`, branded explicit
  consent, `health:read` / `health:write` scopes, public connector registration normalized to
  S256 PKCE, form-encoded token grants, and canonical authorization/OpenID/protected-resource
  metadata.
- One-hour, exact-audience RS256 MCP access JWTs verified locally from the persisted JWKS;
  access-token values are not stored. Sixty-day OAuth refresh credentials and public client
  secrets are hashed by the provider.
- Optional Google Health refresh-token DPoP: one encrypted P-256 private key per connection,
  fresh ES256 proofs, nonce persistence/retry, optimistic credential generations, and an atomic
  token/key replacement statement that leaves the working credential untouched on failure.
- A private consent UI and the SHAUGHV CDN two-family typography contract: Makira for
  body/display and Gail Rock for code, status, and technical content.

### Changed

- Replaced Better Auth's deprecated built-in MCP bridge with exact stable
  `better-auth@1.6.25` and `@better-auth/oauth-provider@1.6.25` on isolated additive tables.
- MCP authorization now requires the canonical resource at authorize and token time, locally
  rechecks the current email allowlist, and requires `health:write` centrally for mutations and
  update acknowledgements.
- Google token refresh is generation-bound and lock-reacquired so a stale refresh cannot
  overwrite or invalidate a newly reconnected credential.

### Security

- Contained stable-provider advisory GHSA-p2fr-6hmx-4528 with one configured audience, exact
  resource checks at every HTTP boundary, token-response audience normalization, and exact
  single-string audience verification at `/api/mcp`. No stable fixed provider release exists.
- Better Auth 1.6.25 performs a predecessor compare-and-set and sequential refresh-family replay
  invalidation, but successor creation/family invalidation are not one transaction. The private,
  allowlist-only deployment accepts and tracks this upstream concurrency limitation rather than
  shipping a prerelease provider or custom security protocol.

### Rollout notes

- The code deploy and additive schema migration do not replace the current Google credential.
  Google `prompt=consent`, post-binding rollback qualification, connector reconnects, the
  seven-day soak, and legacy-table cleanup remain separately evidenced operator gates under
  `#q2`; reconsent and destructive cleanup require fresh approval immediately beforehand.

## [0.2.1] — 2026-07-29

### Changed

- Replaced `mcp-handler` and the monolithic SDK with exact
  `@modelcontextprotocol/server@2.0.0` plus its matching test client.
- Moved the canonical endpoint to one request-scoped server factory supporting the 2026
  sessionless protocol and stateless 2025 compatibility without `Mcp-Session-Id`.
- Kept Vercel Node 24 Functions with Fluid Compute in `iad1`; Edge, Cloudflare, Railway,
  FastMCP, Tasks, subscriptions, and MRTR remain deliberately out of scope.

### Added

- Typed structured tool results with legacy JSON-text fallbacks, complete annotations and
  schemas, resource/list cache hints, exact Host/Origin and 256 KiB body boundaries, and
  payload-free protocol telemetry.

### Verified

- Production deployment `dpl_DDUDdZJmzYg4teo16eAQGr4b1ADS` became READY in `iad1` and passed
  official modern/stateless-legacy clients, 18-tool/6-resource discovery, a non-mutating live
  Health read, Codex connector checks, and warm ping latency without a regression.

## [0.2.0] — 2026-07-25

### Added

- Short-lived AES-256-GCM encrypted exact-response caching with per-user/request AAD,
  range-aware TTLs, force-refresh controls, in-flight deduplication, bounded retry/deadline
  behavior, and explicit live/cache provenance.
- Gap-preserving 7/30/90-day trend summaries, pointer-only Google Health webhook ingestion,
  an MCP-readable update inbox, a persistent notification-freshness ledger, and daily
  retention cleanup.
- Public privacy/retention disclosure plus authenticated same-origin disconnect and
  stored-Health-data deletion controls.

### Changed

- Superseded the two-person audience with ADR-0002: Emmett is the sole approved person,
  represented by `eshaughv@gmail.com` and its native alias `google@emmetts.dev`.
- The MCP transport now rechecks the allowlist on every bearer request, making removal
  immediately effective even before token-table cleanup.
- Updated Next.js to 16.2.11 and overrode its PostCSS and Sharp transitive versions with
  patched releases.

### Security

- Production dependency audit has no high- or critical-severity findings. Two moderate
  advisories remain accepted at this boundary: an unused Windows-only static-file path in the
  MCP SDK's Hono adapter, and a local-development esbuild loader used by Drizzle Kit.

## [0.1.3] — 2026-07-14

OAuth client-compatibility verification release. The deployed 0.1.2 authentication repair was
already working for fresh Claude and Codex connections; this patch closes a refresh-response
cache-control gap found while extending the regression harness.

### Fixed

- Added the RFC 6749 `Cache-Control: no-store` and `Pragma: no-cache` directives to successful
  refresh-token responses, including responses without an ID token to rewrite.

### Added

- Exercised the exact hosted Claude callback (`https://claude.ai/api/mcp/auth_callback`), a
  Claude Code `localhost` loopback callback, and Codex's `127.0.0.1` callback-with-path shape as
  separate DCR/PKCE scenarios.
- Added form-encoded refresh grants for confidential and public clients, fresh-token checks, and
  immediate authenticated MCP initialize/tools-list/UserInfo verification after each refresh.

### Verified

- Fresh native OAuth logins and read-only MCP tool calls succeeded through both Claude Code and
  Codex against production. The correlated server timeline showed token issuance followed by
  authenticated MCP traffic and no relevant OAuth/MCP server errors.

### Notes

- The deprecated provider still does not atomically invalidate a predecessor refresh token after
  issuing its successor. Functional refresh interoperability is verified, while replay-safe token
  families remain explicitly tracked in board task `#oap` for the coordinated provider migration.

## [0.1.2] — 2026-07-13

Claude OAuth compatibility and incident-diagnostics release. The work-computer reconnect remains
the final acceptance check; this release fixes the regression-proven server response defect
without claiming that every downstream Claude credential-persistence failure is resolved.

### Fixed

- Repaired the deprecated Better Auth MCP plugin's OIDC token response. It previously emitted an
  ephemeral `HS256` ID token while discovery advertised `RS256`, omitted `iss`, used millisecond
  `auth_time`, and advertised JWKS/UserInfo endpoints that returned 404. ID tokens are now signed
  with an encrypted, persisted RS256 key, expose a matching JWKS, carry normalized OIDC claims,
  and work with a scope-filtered UserInfo endpoint.
- Required S256 PKCE for every authorization-code flow, including confidential hosted clients;
  rejected any supplied OAuth resource other than the canonical
  `https://health.emmetts.dev/api/mcp`; and preserved no-store/no-cache headers after response
  rewriting.
- Preflighted durable ID-token signing before the legacy handler can consume a one-time code or
  persist credentials, preventing an unavailable signing key from leaving an unrepeatable failed
  exchange.

### Added

- Confidential `client_secret_post` and public `none` DCR/PKCE E2E scenarios with exact signed-out
  parameter preservation, negative PKCE/resource attempts, cryptographic JWKS verification,
  immediate Bearer initialize/tools-list, scoped UserInfo, and zero-row cleanup assertions.
- A Claude work-computer runbook covering silent Google SSO, account/workspace selection,
  Team/Enterprise Owner setup, safe connector-scoped reset, web-first testing, Claude Code's
  callback paste fallback, and the evidence required for an Anthropic escalation.
- Environment-specific JWKS tables so Development, Preview, and Production can share Neon while
  encrypting their private signing keys with distinct Better Auth secrets. The maintained OAuth
  Provider migration is tracked separately as board task `#oap`.

### Changed
- Added ADR-0001, fixing the product boundary as private and allowlist-only for Emmett and
  Christian. Public signup, the unverified first-100-user path, Google restricted-scope
  verification, and CASA are explicitly out of scope unless a future ADR supersedes it.
- Reconciled active documentation and public copy with the two-person audience, and recorded
  the current offboarding caveat: an allowlist removal must be paired with explicit
  session/MCP-token and Google Health connection revocation for immediate cutoff.
- Added a local, Quiver-generated SVG favicon for the Google Health MCP and replaced the
  external generic brand favicons so the deployed site no longer falls back to Vercel's icon.

## [0.1.1] — 2026-07-09

First real-world-feedback release (issues surfaced by agents using the live connector).

### Fixed
- **`query_health_data` now honors `startTime` for `daily-*` data types.** Daily aggregates
  (HRV, resting HR, SpO₂, respiratory rate, VO₂ max, HR zones, sleep-temperature) carry no
  physical timestamp, and no filter was being built for them — a "since July 5" query
  returned the full history. They now auto-filter on the civil `date` field
  (`<snake>.date >= "YYYY-MM-DD"`, live-verified to constrain in both directions); ISO
  instants convert to the user's civil date DST-safely.
- **Sleep `stagesSummary` no longer contains duplicate rows.** Google's raw payload can
  repeat a row (observed on CLASSIC sessions); exact duplicates are now removed so
  downstream sums don't double-count minutes. Genuinely distinct stage rows are untouched.
- **No more misleading `isMain: false` on the main sleep session.** The raw pass-through
  `isMain` was replaced by an optional `googleMarkedMain` (set only when Google sends the
  flag); main-session selection is Google's flag when present, else the longest session.
- **`isPossiblyStale` is cadence-aware.** Once-per-night metrics (sleep, `daily-*` query
  results) use a 48-hour threshold — a value dated today or yesterday is current, not stale.
  Sample-level data keeps the 3-hour threshold. `query_health_data` also now derives
  `latestDataTime` from the returned points instead of always flagging stale.

### Added
- **`stagesStatus` on sleep sessions** (e.g. `REJECTED_COVERAGE`) plus an explanatory
  freshness note when a session is `CLASSIC`: a single asleep/awake block reflects device
  capture conditions (short session, loose band, HR signal gaps), not sleep quality.
- Tool documentation: `daily-*` civil-date filter guidance and a recommendation to use
  `mode: "reconcile"` (Google's merged/deduped stream) when multiple sources log the same
  metric (e.g. Fitbit Air + phone-based MobileTrack).
- 7 unit tests covering the new filter derivation, CLASSIC/STAGES handling, dedupe, and
  staleness thresholds (74 total).

### Notes (recorded, no action)
- Sleep-surface research verdict: Google Health API v4 is the canonical and only cloud
  surface for a Google-account Fitbit Air. No dev API exposes the sleep score; the legacy
  Fitbit Web API sunsets Sept 2026; Health Connect is on-device-only; Google Fit REST is
  EOL end-2026. CLASSIC nights are a device-side capture condition, unrecoverable via API.
- ECG/irregular-rhythm scopes remain deliberately un-requested (minimum-necessary). The
  Fitbit Air has no ECG sensor; adding `googlehealth.irn.readonly` later would require
  reconsent and possibly extra Google review (SaMD-gated).

## [0.1.0] — 2026-07-09

Initial release — milestone **v1** complete and verified end-to-end with a real client.

### Added
- **Remote MCP server** on Vercel (`https://health.emmetts.dev/api/mcp`, streamable HTTP)
  exposing Google Health / Fitbit Air data: 10 read tools (incl. `ping`), 5 write tools,
  5 resources. Every response carries freshness metadata + units; payloads are bounded.
  No sleep/exercise/settings write tools exist, by design.
- **MCP client auth**: better-auth OAuth 2.1 authorization server with Dynamic Client
  Registration, Google-federated sign-in, fail-closed email allowlist, form-encoded token
  endpoint (claude.ai connector compatibility), 60-day rolling refresh tokens.
- **Google Health consent flow** with AES-256-GCM-encrypted tokens in Neon Postgres,
  single-flight refresh, identity mapping, reconnect path.
- **Google Health API client**: 41-data-type registry (kebab/snake/scopes/ops), scope
  prechecks, 401 forced-refresh retry, 429 backoff, pagination caps; DST-safe Luxon time
  utilities (civil vs physical time, midnight-crossing sleep windows).
- **Write surface** with Zod validation, explicit-input-only values, and a full mutation
  audit log. `update_nutrition_log` uses replace semantics (live PATCH endpoint 500s);
  `update_profile` dropped (live endpoint 403s despite granted scope) — both documented
  Google-side bugs.
- **Verification**: 67 unit tests; live read checks 11/11; live write roundtrips 21/21;
  headless OAuth+MCP end-to-end harness (`scripts/live-verify-e2e.ts`) green against
  localhost (full DCR → PKCE authorize → token → tools chain) and production; real-client
  battery run through the claude.ai "Shaughv Health" connector.
