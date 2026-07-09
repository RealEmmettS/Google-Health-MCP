TT;DR: Build the typed Google Health API client — data-type registry (kebab/snake/scope/ops), list/reconcile/rollUp/dailyRollUp/create/patch/batchDelete, normalized errors, pagination, 429 backoff — plus the Luxon time helpers, all proven against a mocked v4 API.

## Why
`docs/PLAN.md` §"Google Health client" + handoff §18/§21. Every tool in Phases 5–6 calls through this one client; correctness here is leverage.

## Plan
- `src/google-health/registry.ts`: SINGLE source of truth per data type: kebab endpoint name, snake filter name, scope, allowed ops, record type — transcribed from the data-types table in the docs Emmett pasted (in repo: see docs/PLAN.md pointers). Tools validate against this allowlist.
- `src/google-health/client.ts`: `GoogleHealthClient(userId)` → `getValidAccessToken`; base `https://health.googleapis.com/v4`; methods list/get/reconcile/rollUp/dailyRollUp/create/patch/batchDelete; pagination (`nextPageToken`); scope precheck against connection's granted scopes → `missing_scope` error; 401→one refresh retry→`reauth_required`; 429→exponential backoff (2 retries)→`rate_limited`+retryAfterSeconds; empty data → explicit no-data message (never imply "nothing happened").
- `src/time/ranges.ts` (Luxon): today/yesterday/lastNight/currentWeek in user TZ (default America/Chicago); civil vs physical range builders; dailyRollUp civil dates as NON-zero-padded ints (API rejects leading zeros); sleep-crossing-midnight: query by `sleep.interval.civil_end_time >= "<date>"`.
- Fixtures modeled on real response shapes from the pasted docs (steps list, sleep reconcile w/ stages, exercise list, rollup, nutrition CRUD, 401 expired, 429). Mock via MSW or undici MockAgent.

## Impact
None external (all mocked). Registry mistakes would silently break tools later — verify names against the docs table, not memory.

## Acceptance
Full mocked integration suite green; time-range unit tests cover DST boundaries.

## Verification
- [x] Registry entries match the docs table exactly (fable spot-checked body-fat/active-zone-minutes/nutrition-log/total-calories after sonnet-subagent transcription; 41 entries, snake==kebab underscored verified programmatically)
- [x] Vitest: list+pagination (pageSize cap 100, pageToken passthrough), reconcile (dataSourceFamily), rollUp (physical UTC), dailyRollUp (civil, plain numbers — no leading zeros in serialized JSON)
- [x] Vitest: 401→forced-refresh→retry→success; scope precheck fails BEFORE any network call
- [x] Vitest: 429→bounded backoff→success, and exhausted-retries→rate_limited with Retry-After honored
- [x] Vitest ranges: 23h spring-forward day (2026-03-08), 25h fall-back day (2026-11-01), Monday week start, America/Chicago default, explicit TZ override, last-night midnight-crossing window

## Status
DONE (code + mocked verification). Live validation against real Fitbit data happens via `npx tsx scripts/gh-smoke.ts` immediately after Emmett's Phase 3 consent click — it exercises identity + a real steps dailyRollUp end-to-end. Client details: forced-refresh retry on 401 (token-service gained a forceRefresh option), pageSize hard-capped at 100 (payload discipline), scope prechecks from the connection's GRANTED scopes (not the requested set), profile/settings endpoint paths flagged for verification against the live REST reference in Phase 5 before those tools ship.

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
- 2026-07-09 01:15 — registry transcribed by sonnet subagent (41 types), verified by fable (agent: fable)
- 2026-07-09 01:33 — client + time utils + errors complete; 65/65 tests green incl. DST + concurrency; moved to Done pending live smoke (agent: fable)
