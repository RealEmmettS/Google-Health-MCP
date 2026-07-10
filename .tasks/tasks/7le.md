TT;DR: Make health.emmetts.dev look like SHAUGHV — restyle the 4 UI files (layout, home/dashboard, sign-in, sign-out button) with the shaughv-design kit + CDN brand assets. Centered on screen preferred, no nav-bar required. Don't touch the auth logic or anything under app/api / src.

## Why
v1 shipped with placeholder styling (dark bg + mint accent + unloaded monospace stack). The MCP is live and in daily use via Emmett's claude.ai connector; the human-facing pages should represent the brand. Task created by Emmett; deferred to a fresh agent 2026-07-09.

## Plan
**READ THE FULL HANDOFF FIRST: `docs/agents/handoff/2026-07-09-003-7le-shaughv-design-pass-handoff.md`** — it has the complete surface inventory, functional invariants, palette, deploy mechanics, and context. Short version:
1. Invoke `shaughv-code:shaughv-design` (task names it) + `shaughv-code:shaughv-cdn` (assets/fonts via cdn.shaughv.com `/tree.json` — never hardcode paths).
2. Restyle `app/layout.tsx`, `app/page.tsx` (signed-out + dashboard states), `app/sign-in/page.tsx`, `app/components/sign-out-button.tsx`. Centered layout, no nav-bar.
3. DO NOT touch: the sign-in authorize-resume logic (`callbackURL` building), the `/api/auth/google-health/start` link, the `?health=`/`?health_error=` banners, server/client component boundaries, anything under `app/api/`, `app/.well-known/`, `src/`. TS stays pinned ^5.

## Impact
Prod-visible page changes on a live, in-use service. The auth flows route THROUGH these pages (sign-in resumes MCP authorize) — a styling mistake can break connector logins, so the regression check below is mandatory.

## Acceptance
Site reads as SHAUGHV (Emmett approves), centered, no nav-bar; all auth flows still work.

## Verification
- [ ] typecheck + 67 tests + build green
- [ ] All three states visually checked on dev (signed-out home, /sign-in, signed-in dashboard) — Chrome MCP preferred
- [ ] Auth regression: `npx tsx scripts/live-verify-e2e.ts http://localhost:3000` ALL-PASS with dev server running (full DCR→authorize→token→MCP chain)
- [ ] /sign-in click test: authorize-resume still lands back at the MCP authorize endpoint (script doesn't cover the page UI)
- [ ] Deployed: health.emmetts.dev renders on-brand; /api/health/status 200; prod e2e script still passes; auto-deploy actually fired (webhook skipped a push once)
- [ ] Emmett approves the look

## Status
Not started. Unblocked (#p7d done 2026-07-09, milestone #v1 closed). Handoff doc ready with everything needed.

## Activity
- 2026-07-09 23:25 — detail file + full handoff written for the next agent at Emmett's direction; v1 closed, task unblocked (agent: fable)
