TT;DR: Add a short-lived encrypted cache at the Google API operation boundary, then remove duplicate/serial reads and correct freshness without hiding when data came from cache.

## Why

Emmett directly requested faster answers, faster effective sync visibility, and an encrypted health cache. Current services duplicate sleep reads, serialize independent calls, and sometimes return freshness that is always stale or based only on nonzero steps.

## Scope

Cache exact Google read responses at their original granularity using AES-256-GCM and a purpose-derived key. TTLs: 2 minutes for ranges touching today, 30 minutes for closed historical ranges, and 60 minutes for profile/settings. Webhooks and successful writes invalidate overlapping entries. Preserve existing tool names, bounded outputs, token encryption, redaction, no-diagnosis language, and Google as source of truth.

## Plan

Add encrypted cache schema/service and migration; wire reads at the Google client boundary; add request-scoped dedupe and concurrency limit three; expose live/cache provenance; correct rollup/context/sync freshness; add bounded retry deadlines and payload-free timing telemetry.

## Impact

Repeated and composite reads become faster while returning data no more than the declared TTL old. Risks are cache-key collisions, cross-user leakage, stale invalidation, ciphertext/key mistakes, and latency regressions from extra database work.

## Acceptance

**Functional bar:** repeat reads use encrypted cache safely, forced/live reads bypass it, writes invalidate it, and composite tools make fewer Google calls with truthful freshness.
**Evidence bar:** unit/integration tests, migration inspection, typecheck/build, deterministic concurrency/call-count tests, and controlled timing evidence.
**Gate ownership:** repository policy requires automated gates; Emmett owns real-account acceptance.
**Valid bounded outcomes:** verified, partial, blocked, or not verified.
**Budget / stop rule:** after two non-informative performance cycles, freeze the route and audit measurement/cache boundaries.

## Evidence

| Criterion | Oracle / invocation | Raw result or pointer | Interpretation | Limitation | Status |
|---|---|---|---|---|---|
| Baseline tests | `npm test -- --run`; `npm run typecheck` | 83/83 tests and typecheck passed before implementation | Starting tree is healthy | Does not prove production latency | PASS |
| Encrypted cache adversarial suite | `npm test -- --run` | 114/114 tests; cache ciphertext/AAD/tamper/TTL/bypass/invalidation/rolling-bridge and client dedupe/concurrency/retry tests pass | Cache fails closed and faster paths preserve isolation | Unit fixtures do not prove Vercel latency | PASS |
| Shared Neon migration | `npm run db:migrate`; information-schema query | Migration applied; cache=0 immediately after; additive nullable rolling bridge | Schema is live without breaking 0.1.3 during deploy | Plaintext bridge column remains until cleanup release | PASS |
| Real Google read/cache | `npx tsx scripts/live-verify.ts`; `scripts/live-verify-v11.ts` | All 11 read checks pass; second 9-metric trend read cache-only; 32 cache rows, 0 plaintext, 0 incomplete cipher | Existing token continuity and encrypted cache behavior proven against real data | Local runtime, not Vercel p95 | PASS |
| Build | `npm run build` with local Better Auth secret supplied in process env | Next 16 production build passed with all 17 routes | Release compiles and prerenders | Google client vars were not supplied to local static collection; warnings only | PASS |

## Verification

- [x] Cache rows contain ciphertext/IV/tag and no plaintext health payload
- [x] Cross-user, TTL, bypass, overlap invalidation, and write invalidation tests pass
- [x] Context performs one sleep read and Google-call concurrency never exceeds three
- [x] Freshness/provenance and retry-deadline tests pass
- [x] `npm test`, `npm run typecheck`, and `npm run build` pass
- [x] Controlled timing shows cache hits in ~39-188ms and live reads in ~191-954ms without a failed read-service check

## Status

DONE. Exact Google responses are encrypted with per-user/request AAD, served under range-aware TTLs with explicit provenance, invalidated after writes/webhooks, and physically expired daily. Real-data continuity and ciphertext-only storage passed.

## Activity

- 2026-07-25 04:05 — created and moved directly to Active from Emmett's full-release order (agent: codex)
- 2026-07-25 11:00 — implemented cache/dedupe/concurrency/retry/freshness/provenance, applied the rolling-safe migration, passed 114 tests/typecheck/build, and verified all read services plus ciphertext-only cache against Emmett's real connection (agent: codex)
