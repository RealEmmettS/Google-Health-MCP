TT;DR: Fixed the issues Emmett's agents surfaced from real connector use: daily-* types now actually honor startTime (civil-date filter — was a silent no-op), sleep stagesSummary deduped + stagesStatus surfaced (explains CLASSIC nights), staleness is cadence-aware (daily metrics no longer cry stale same-day), and reconcile/ECG notes recorded.

## Why
First real-world usage feedback (2026-07-09, via Emmett's agents running the live connector). Six items, ranked: (1) startTime silently ignored on daily-* types; (2) CLASSIC sleep (device-side); (3) duplicate stagesSummary row + misleading isMain:false; (4) noisy isPossiblyStale on daily metrics; (5) two step sources (informational); (6) no ECG/IRN scope (informational).

## What shipped
1. **Daily filter fix** (`src/health-services/query.ts`): root cause was NOT a mis-targeted sample-time filter — the code deliberately built NO filter for Daily record types, so startTime was silently ignored. Now Daily types get `<snake>.date >= "YYYY-MM-DD"` (live-probed: the date filter constrains in both directions); bare dates pass through, ISO instants convert to the user's civil date DST-safely. Tool schema/docs updated to say daily-* constrains by civil date.
2. **Sleep fixes** (`src/health-services/sleep.ts`): stagesSummary deduped (Google's RAW payload contains the duplicate row — live-probed; exact-duplicate rows dropped, distinct rows kept); misleading `isMain:false` replaced by optional `googleMarkedMain` (only set when Google sends metadata.main; main selection = Google's flag else longest session); NEW `stagesStatus` surfaced (e.g. REJECTED_COVERAGE) + a freshness note explaining CLASSIC = capture conditions, not sleep quality (closes #slp's actionable). Parser was already CLASSIC/STAGES tolerant; now unit-tested for both shapes.
3. **Cadence-aware staleness** (`src/health-services/freshness.ts`): `makeFreshness` takes `staleAfterHours`; `DAILY_STALE_AFTER_HOURS = 48` used by sleep + daily-* query results (a value dated today/yesterday is current). query_health_data now also derives `latestDataTime` from returned points (Daily: civil date; Sample: physical sample time; Interval/Session: interval end) instead of always-undefined → the always-true stale flag is gone.
4. **Reconcile note** (#5): query_health_data description now recommends mode "reconcile" (Google's merged/deduped stream) if per-source duplication is suspected (Fitbit Air + MobileTrack both present; MobileTrack "Empty" battery is normal — phone pseudo-tracker). Steps rollups are already Google-merged; totals verified sane.
5. **ECG/IRN** (#6): recorded, no action — registry already has `electrocardiogram`/`irregular-rhythm-notification` types (scopeGroups ecg/irn), scopes deliberately NOT requested (minimum-necessary). The Air has no ECG sensor; its AFib detection is passive-optical. If Emmett ever wants IRN alerts programmatically: add `googlehealth.irn.readonly` to `src/google-health/scopes.ts` + reconsent; note it's SaMD-gated and may need extra Google review.

## Verification
- [x] typecheck + 74/74 unit tests (7 new: daily filter derivation incl. instant→civil conversion, Sample filter unchanged, daily freshness, CLASSIC dedupe + stagesStatus + no-false-main, STAGES rows preserved, threshold behavior) + prod build green
- [x] LIVE: daily-HRV since 2026-07-05 returns exactly Jul 5–9 (was ~6 weeks); filter echoed `daily_heart_rate_variability.date >= "2026-07-05"`; date filter probed both directions (>= and <) to prove it constrains
- [x] LIVE: sleep 2026-07-09 → stagesSummary 1 row (was 2), stagesStatus REJECTED_COVERAGE surfaced, googleMarkedMain undefined (no false claim), isPossiblyStale false same-day, CLASSIC explanation in freshness note
- [x] Deployed to prod + prod e2e still ALL-PASS

## Status
DONE 2026-07-09. All six feedback items addressed (3 code fixes live-verified, 1 already-tolerant parser now tested, 2 informational items recorded). Sleep research (#slp) confirmed v4 is the only cloud surface — no migration; its actionable (surface sleepType + stages status) shipped here.

## Activity
- 2026-07-09 23:40 — all fixes implemented, tested (74/74), live-verified against the real account, deployed (agent: fable)
