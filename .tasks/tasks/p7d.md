TT;DR: Deploy to Vercel, finish the Google console config (redirect URIs + publish to production), connect the database and env vars, then prove v1 end-to-end from Claude Code, claude.ai (web+mobile), and ChatGPT with the full prompt battery.

## Why
`docs/PLAN.md` Phase 7 + "Verification / E2E". This phase interleaves agent work with Emmett-only steps — coordinate, don't block.

## Plan
1. Push → **Emmett**: import repo in Vercel (suggest project name `shaughv-health-mcp`), connect Neon in Storage tab.
2. Env vars (agent via `vercel link`+`vercel env add`, or Emmett): GOOGLE_CLIENT_ID/SECRET, TOKEN_ENCRYPTION_KEY (generate 32B base64), BETTER_AUTH_SECRET, BETTER_AUTH_URL + NEXT_PUBLIC_APP_URL (prod URL), ALLOWED_GOOGLE_EMAILS. DATABASE_URL comes from Neon integration.
3. **Emmett** (agent can drive via Chrome MCP with him watching): Google console → OAuth client redirect URIs:
   - `https://<prod>/api/auth/callback/google`
   - `https://<prod>/api/auth/google-health/callback`
   - `http://localhost:3000/api/auth/callback/google`
   - `http://localhost:3000/api/auth/google-health/callback`
   Then Audience page → PUBLISH APP to "In production" (kills the 7-day refresh-token expiry).
4. Deploy; run migrations from dev box; Emmett signs in on prod + completes health consent; verify token rows.
5. E2E: MCP Inspector vs prod → Claude Code (`claude mcp add --transport http health https://<prod>/api/mcp`) → claude.ai custom connector (TEST EARLY — token endpoint form-encoding quirk) → ChatGPT connector (DCR).
6. Prompt battery (docs/PLAN.md §Verification 4) with a synced Fitbit; verify audit rows; negative checks (401 unauth, non-allowlisted rejection, no plaintext tokens in DB/logs).

## Impact
System goes live on the public internet. Auth layers are the protection — verify negative checks BEFORE handing out the URL.

## Acceptance
All five verification groups in docs/PLAN.md §"Verification / E2E" pass.

## Verification
- [ ] Vercel production deploy green; /api/health/status 200
- [ ] Migrations applied to Neon prod data
- [ ] Emmett: health consent completed on prod; connection row active; encrypted tokens only
- [ ] Claude Code connects via OAuth and answers "how many steps do I have today?" with real data
- [ ] claude.ai web connector works; mobile app too
- [ ] ChatGPT connector registers via DCR and calls tools
- [ ] Prompt battery passes (steps/goal/sleep/tired/HR/food/exercise + log/edit/delete snack + water + weight)
- [ ] Negative: unauth 401; second Google account rejected; DB rows show no plaintext tokens; logs redacted
- [ ] OAuth app published to production (refresh token survives >7 days — recheck after a week)

## Status
Not started. Prereq: #p6w. Emmett-gated steps: repo import, Neon connect, console config, consent, connector adds.

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
