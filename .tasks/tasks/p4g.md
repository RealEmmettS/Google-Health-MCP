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
- [ ] Registry entries match the docs table exactly (spot-check body-fat/active-zone-minutes/nutrition-log mappings + ops)
- [ ] Vitest: list+pagination, reconcile, rollUp (physical), dailyRollUp (civil, no leading zeros in serialized JSON)
- [ ] Vitest: 401→refresh→retry→success; refresh-fail→reauth_required
- [ ] Vitest: 429→backoff→rate_limited shape with retryAfterSeconds
- [ ] Vitest ranges: DST spring/fall dates, midnight-crossing sleep, America/Chicago default, explicit TZ override

## Status
Not started. Prereq: #p3c (token service).

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
