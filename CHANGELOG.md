# Changelog

All notable changes to shaughv-health-mcp. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.
The `.tasks/` board tracks in-flight work; this file records what shipped.

## [Unreleased]

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
