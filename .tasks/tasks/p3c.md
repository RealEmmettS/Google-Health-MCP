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
- [ ] State: valid→consumed once; reused/expired/foreign state rejected (unit tests)
- [ ] Callback stores ENCRYPTED tokens only (inspect row: ciphertext/iv/tag, no `ya29.`/`1//` prefixes anywhere)
- [ ] `healthUserId` + `legacyUserId` stored after consent
- [ ] Mocked refresh: near-expiry token refreshes once under 10 concurrent calls (single-flight test)
- [ ] Mocked refresh failure → connection status `reauth_required`
- [ ] Reconnect updates existing connection (no duplicate rows)

## Status
Not started. Prereq: #p2a (session gate on start route). Local E2E needs Emmett to add localhost redirect URIs in Google console (can happen in Phase 7 batch; until then, mocked tests carry).

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
