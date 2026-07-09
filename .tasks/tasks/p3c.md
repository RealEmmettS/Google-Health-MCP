TT;DR: Build the one-time Google Health consent flow (health scopes, offline access) that stores AES-encrypted tokens in Neon, maps Google Health identity, and refreshes access tokens safely under concurrency.

## Why
Auth layer #3 of `docs/PLAN.md` ("Four auth layers"). Separate from MCP-client login by design: N clients connect, ONE health connection exists.

## Plan
- `app/api/auth/google-health/start/route.ts`: requires better-auth session; creates `oauth_states` row (hashed state, 10-min expiry); redirects to Google with the 9 health scopes (plan §"Health scopes"), `access_type=offline`, `prompt=consent`.
- `app/api/auth/google-health/callback/route.ts`: validate+consume state (single-use); exchange code; encrypt tokens → `oauth_tokens`; upsert `oauth_connections` (update-not-duplicate; store granted scopes — Google may grant a subset); GET `https://health.googleapis.com/v4/users/me/identity` → store `healthUserId` + `legacyUserId` on `app_users`; redirect to dashboard success.
- `src/auth/token-service.ts`: `getValidAccessToken(userId)` — decrypt, return if >5min left; else refresh under `SELECT ... FOR UPDATE` (single-flight); persist new encrypted token; on refresh failure mark connection `reauth_required`. NOTE: Google may NOT return a new refresh token on refresh — keep the old one unless replaced.
- Reconnect path: same start route; detect scope changes; never blindly duplicate rows.

## Impact
Live Google tokens at rest (encrypted). Until Emmett publishes the OAuth app (Phase 7), refresh tokens die after 7 days — surface `reauth_required` cleanly on the dashboard and in MCP error shapes.

## Acceptance
Full consent completes locally (localhost redirect URI); rows correct; refresh path proven against mocked token endpoint.

## Verification
- [x] State: valid→consumed once; reused/expired/foreign state rejected (unit tests + prod bogus-state check)
- [x] Callback stores ENCRYPTED tokens only — proven the hard way: rows written under the prod key were UNDECRYPTABLE with any other key (the split-key incident), i.e. ciphertext-at-rest confirmed against live data; no plaintext write path exists in code
- [x] `healthUserId` (455803974908071566) + `legacyUserId` (C8QFBG) stored after consent — verified via live smoke
- [x] Mocked refresh: single-flight claim/wait/takeover paths unit-tested (fake-timer concurrency tests)
- [x] Mocked refresh failure → connection status `reauth_required` (unit test)
- [x] Reconnect updates existing connection — verified LIVE: post-key-rotation reconnect reused the single connection row (unique user+provider) and smoke succeeded immediately

## Status
DONE — full live verification 2026-07-09 ~01:50: consent + reconnect completed by Emmett on prod; smoke test (`npx tsx scripts/gh-smoke.ts`) returned real identity and a real steps dailyRollUp (32 steps, correct civil-day shape) through the entire encrypted-token pipeline. Original notes preserved below for reference. Was: awaiting Emmett's consent click test (dashboard → "Connect Google Health" → Google consent with the unverified-app warning → back to dashboard showing CONNECTED). Then run `npx tsx scripts/gh-smoke.ts` to verify: connection row, identity mapping, encrypted-token round trip against the real API, live steps rollup. Implementation notes: single-use hashed DB state (atomic UPDATE consume); refresh single-flight via claimable refresh_in_flight_until column (neon-http can't hold transactions; Google doesn't rotate refresh tokens so takeover-double-refresh is benign); saveTokens preserves the stored refresh token when Google omits one; forceRefresh option added for the client's 401 retry.

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
- 2026-07-09 01:25 — consent routes + state + token store/service + dashboard status live on dev; unauthenticated/bogus-state paths verified (agent: fable)
- 2026-07-09 01:33 — deployed to prod (start route 307→sign-in verified); awaiting Emmett consent click + smoke (agent: fable)
- 2026-07-09 01:45 — CONSENT SUCCEEDED (emmett): connection active, 9 scopes, healthUserId 455803974908071566 + legacy C8QFBG mapped. Local smoke exposed the split-key problem (local vs prod TOKEN_ENCRYPTION_KEY on one shared DB) + the sensitive-env write-only quirk → rotated to one shared key, redeploying; Emmett reconnects once, then smoke re-runs (agent: fable)
- 2026-07-09 01:50 — reconnect done (emmett); smoke PASSED: real identity + real steps rollup (32 steps, 2026-07-09). All verification ticked; moved to Done (agent: fable)
