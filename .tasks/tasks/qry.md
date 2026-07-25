TT;DR: Add compact 7/30/90-day health trends with explicit coverage, gaps, units, source timestamps, and no medical interpretation.

## Why

Emmett requested richer long-term data in the same release. Existing generic pagination exposes raw pages but does not provide a bounded cross-metric trend product.

## Scope

Add a reusable trends service and MCP tool for available steps, sleep, resting heart rate, HRV, oxygen saturation, respiratory rate, exercise, hydration, and nutrition. Support 7, 30, and 90 days, chunk Google-limited ranges, preserve gaps, cap output, and let the LLM interpret.

## Plan

Define typed metric/coverage output, reuse the exact-response cache, chunk official 14/90-day windows, parallelize within the request limit, and register the tool after service tests.

## Impact

One call can answer comparative questions with fewer tool round trips. Risks are payload growth, false zero/missing equivalence, incomparable sources, and accidental medical conclusions.

## Acceptance

**Functional bar:** one bounded tool returns requested daily trends with units, coverage, gaps, and freshness.
**Evidence bar:** deterministic fixtures for range chunking, DST, gaps/zeros, cache behavior, scope absence, payload caps, typecheck/build, and a live read.
**Gate ownership:** automated gates are repository policy; Emmett owns real-data usefulness acceptance.
**Valid bounded outcomes:** verified, partial for metrics unavailable from Google's live contract, or not verified.
**Budget / stop rule:** unsupported roadmap data is omitted with an explicit limitation, never simulated.

## Verification

- [x] 7/30/90-day bounded ranges, pagination, civil dates, gaps, and true-zero fixtures pass
- [x] Output includes units, coverage, freshness, and source limitations
- [x] Payload remains bounded and contains no diagnosis language
- [x] Live connector returns at least one available metric correctly

## Status

DONE. Unit, live Google, and production MCP connector evidence all pass with explicit coverage and cache provenance.

## Activity

- 2026-07-25 04:05 — created from Emmett's direct order to include richer trends in v1.1 (agent: codex)
- 2026-07-25 11:00 — added `get_health_trends` for nine metrics and 7/30/90-day windows; corrected live civil-rollup, oxygen, and respiratory shapes; 7-day live run returned coverage and a cache-only repeat (agent: codex)
- 2026-07-25 11:31 — production MCP force-refresh returned live 7-day steps (7/7) and sleep (6/7), followed by an identical cache-only repeat (agent: codex)
