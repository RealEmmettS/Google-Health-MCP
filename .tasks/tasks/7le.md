TT;DR: Make health.emmetts.dev look like SHAUGHV. Signed-out = tiny marketing + login button → Google sign-in → signed-in "MCP profile" page (NO health data — connection status + connector setup, made beautiful). Keep a BIG connect/reconnect Google Health button and a status bar (connection state + last-sync if possible). Add the raw MCP URL (copyable) and the Codex install command. Centered, no nav-bar. Don't touch the server.

## Why
v1 shipped with placeholder styling (dark bg + mint accent + unloaded monospace stack). The MCP is live and in daily use via Emmett's claude.ai connector; the human-facing pages should represent the brand. Spec dictated by Emmett 2026-07-09; deferred to a fresh agent.

## Plan
**READ THE FULL HANDOFF FIRST: `docs/agents/handoff/2026-07-09-003-7le-shaughv-design-pass-handoff.md`** — it carries Emmett's full spec, the design-system + CDN rules, the what's-built inventory, the DO-NOT-TOUCH list, the status-bar implementation guidance (Suspense-streamed getSyncStatus), and deploy mechanics. Short version:
1. Invoke `shaughv-code:shaughv-design` + `shaughv-code:shaughv-cdn` (both named in the task). Assets/fonts from cdn.shaughv.com via its `/tree.json` manifest — never hardcode paths. Dashboard leans brutalist dark (live-site surface).
2. Restyle ONLY: `app/layout.tsx`, `app/page.tsx`, `app/sign-in/page.tsx`, `app/components/sign-out-button.tsx` (+ new UI-only files under `app/`).
3. Page spec: signed-out marketing+login; signed-in MCP profile — big Connect/Reconnect button, status bar (status/scopes/connectedAt from DB; last-sync via Suspense-streamed `getSyncStatus`, `<shaughv-loader>` fallback), prominent copyable MCP URL `https://health.emmetts.dev/api/mcp`, client setup incl. the Codex install command (VERIFY current syntax from live docs before shipping), allowlist note. No health values anywhere.
4. DO NOT TOUCH: `app/api/**`, `app/.well-known/**`, `src/**` (import read-only only), `scripts/`, `tests/`, `drizzle/`, deps/tsconfig (TS stays ^5); in-page invariants: sign-in authorize-resume `callbackURL` logic + Suspense wrapper, `?health=`/`?health_error=` banners, Connect button stays a plain anchor to `/api/auth/google-health/start`, page.tsx stays a server component.

## Impact
Prod-visible changes on a live, in-use service. The auth flows route THROUGH these pages (sign-in resumes MCP authorize) — a styling mistake can break connector logins, so the regression gate below is mandatory.

## Acceptance
Site reads as SHAUGHV (Emmett approves), centered, no nav-bar, spec items all present; all auth flows still work.

## Verification
- [ ] typecheck + 74 tests + build green
- [ ] All three states visually checked on dev (signed-out marketing, /sign-in, signed-in profile) — Chrome MCP preferred
- [ ] Status bar: connection state renders on load; last-sync streams in via Suspense without blocking paint; degrades cleanly when not connected/reauth
- [ ] Raw MCP URL prominent + copyable; Codex install command shown and VERIFIED against current Codex docs
- [ ] No health data values anywhere on the page (sync metadata only)
- [ ] Auth regression: `npx tsx scripts/live-verify-e2e.ts http://localhost:3000` ALL-PASS with dev server running (full DCR→authorize→token→MCP chain)
- [ ] /sign-in click test: authorize-resume still lands back at the MCP authorize endpoint (script doesn't cover the page UI)
- [ ] Deployed: health.emmetts.dev renders on-brand; /api/health/status 200; prod e2e script still passes; auto-deploy actually fired (webhook skipped a push once)
- [ ] Emmett approves the look

## Status
Not started. Unblocked (#p7d done 2026-07-09, milestone #v1 closed). Full spec + handoff ready — read the handoff doc before touching anything.

## Activity
- 2026-07-09 23:25 — detail file + full handoff written for the next agent at Emmett's direction; v1 closed, task unblocked (agent: fable)
- 2026-07-09 23:45 — Emmett dictated the concrete page spec (marketing+login → MCP profile; big connect button; status bar w/ last-sync; raw MCP URL; Codex install command; no health data); handoff + this file updated with the spec, the design/CDN skill guidance, and a sharpened built-inventory + DO-NOT-TOUCH list (agent: fable)
