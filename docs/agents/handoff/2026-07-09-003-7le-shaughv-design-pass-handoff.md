# Handoff: #7le — SHAUGHV design pass on health.emmetts.dev

**Date:** 2026-07-09
**Session:** Session 3 of the day (written by the v1-completion session, for the NEXT agent)
**Agent:** Claude Code (Fable 5)
**Task/ticket ID(s):** #7le (To-Do → yours to move to Active)

---

## Session Narrative

Emmett deferred this task to you explicitly: "leave 7le for the next agent … but produce a
solid /handoff for the agent for 7le based on everything we've talked about." He then dictated
the design spec below and asked that this handoff be crystal clear about **what's already built
and what not to touch**. Context in brief: v1 of this private Google Health MCP server is
**done, live, in daily use, and milestone-closed** (2026-07-09). Emmett's "Shaughv Health"
connector is live in claude.ai right now — a live Claude session verified every tool through
the real connector OAuth path today (real reads + write roundtrips, cleaned up). Your job is
purely the **look of the human-facing pages**. The server is not your job and is easy to break
from the UI if you touch the wrong seam — hence the DO-NOT-TOUCH list below.

## Emmett's Design Spec (his requirements, near-verbatim — this is the brief)

1. **Signed-out (main site):** "a tiny bit of marketing and a login button." Clicking login →
   the Google sign-in flow → lands in the signed-in view.
2. **Signed-in ("your MCP profile"):** shows the same information the current account/detail
   page already has (connection state, MCP connector setup) — "just make that look more
   beautiful." **It must NOT surface any health data.** (Sync *metadata* — status, last-sync
   time — is explicitly wanted; steps/sleep/HR values are not.)
3. **Must keep:**
   - a BIG button for **sign in / connect / reconnect Google Health**;
   - a **status bar** showing the connection status — and, if possible, the **last time it
     synced** — populated on page load.
4. **Add:**
   - visibility into the **raw MCP URL** (`https://health.emmetts.dev/api/mcp`) for connecting
     manually via Claude Code / claude.ai web UI — make it prominent and copyable;
   - the **Codex install command** ("the cloud install"). Verify the current syntax from live
     docs at build time (repo rule: never wire tool/library invocations from memory) — likely
     shape is `codex mcp add health --url https://health.emmetts.dev/api/mcp` or a
     `config.toml` `[mcp_servers.health]` entry, but CONFIRM before shipping it as copy.
5. **Plus:** "anything else you feel should go on that page" — sensible candidates: copy-to-
   clipboard on the MCP URL and install commands, granted-scope count + connected-since date
   (already available), Claude Code / claude.ai / ChatGPT setup steps (already drafted in the
   current page), the allowlist notice, device battery from sync status. Keep it restrained.
6. Layout: **centered on screen preferred, no nav-bar required** (from the original task line).

## Design System (both skills are named IN the task — invoke them first)

Invoke **`shaughv-code:shaughv-design`** and **`shaughv-code:shaughv-cdn`** before writing any
UI. What you'll find, so you can plan:

- **shaughv-design:** read its `README.md`, `colors_and_type.css` (the only source of design
  tokens — never invent hex values), and `BRANDMARK.md` (mandatory before placing the mark).
  Two UI kits: `ui_kits/personal_site/` (brutalist dark — the live emmettshaughnessy.com look)
  and `ui_kits/vintage_site/` (Bauhaus cream). **This dashboard leans brutalist dark** — the
  current placeholder is already near-black, and it's Emmett's live-site surface; confirm with
  him only if you want to argue for cream. Content rules: UPPERCASE headlines/labels/buttons
  (via CSS), sentence-case body, first-person singular, **no emoji ever**, Lucide line icons
  only, `◆` as the only unicode glyph, em-dashes with hair spaces, dry understated tone.
  Every loading state must use `<shaughv-loader>` — no custom spinners.
- **shaughv-cdn:** ALL brand assets and fonts come from `https://cdn.shaughv.com`. The one
  rule: **fetch `https://cdn.shaughv.com/tree.json` and use the `url`/`embed`/`css_url` fields
  it returns — never hardcode paths from memory.** Fonts: IBM Plex Mono (mono/labels) + Makira
  (display) via `fonts.all`, or the opt-in **Unbounded** (its own stylesheet) for brutalist
  headlines — Unbounded is the right call if you go dark/brutalist. Favicon: the
  `SHAUGHV-Favicon-{Dark,Light}.svg` pair with `prefers-color-scheme` media queries (the site
  currently has NO favicon — add it). Animated brand mark `<shaughv-mark>` via
  `js/animated-brand-mark.js`, **64px hard minimum**, static `SHAUGHV-Official.svg` below
  that. Preload fonts with `crossorigin`. Don't cachebust binary URLs. CDN is open-CORS and
  read-only; external loads from it are fine on this site (no CSP is configured).

## What's ALREADY BUILT (working, verified, in use — none of it is your job)

The repo is a complete, live MCP server. Full architecture in `docs/PLAN.md`, agent rules in
repo `CLAUDE.md`, working memory in `.tasks/CLAUDE.md`, prior handoffs (001 = architecture,
002 = E2E close-out) in this folder. Inventory:

- **MCP surface:** 15 tools (10 read incl. `ping`, 5 write) + 5 resources at `/api/mcp`,
  served by `app/api/[transport]/route.ts` → `withMcpAuth` + `createMcpHandler` →
  `src/mcp/register-tools.ts`, thin handlers over `src/health-services/*`.
- **Auth (4 layers, never conflate):** better-auth OAuth 2.1 AS + DCR (Google-federated,
  email-allowlisted) for MCP clients under `/api/auth/*` + well-known metadata routes; a
  separate Google Health consent flow (`/api/auth/google-health/start` + `/callback`) storing
  AES-256-GCM-encrypted tokens in Neon with single-flight refresh.
- **Google Health client:** 41-type registry, scope prechecks, 401-retry/429-backoff
  (`src/google-health/*`), Luxon time utils (`src/time/*`).
- **Verification assets:** 67 unit tests, `scripts/live-verify.ts` (11/11 reads),
  `scripts/live-verify-writes.ts` (21/21 writes), `scripts/live-verify-e2e.ts` (full OAuth+MCP
  chain — your regression gate).
- **Verified today with a REAL client:** Emmett's claude.ai connector listed all 15 tools and
  ran reads + write roundtrips against his real account, through prod.

## DO NOT TOUCH (UI/UX work stays out of all of this)

- **Anything under `app/api/`** — the MCP endpoint, better-auth catch-all, Google Health
  start/callback, health status route.
- **Anything under `app/.well-known/`** — OAuth discovery metadata (connectors read these).
- **Anything under `src/`** — auth, token store/encryption, Google Health client + registry,
  health services, MCP tool registration, DB schema, redaction. (You MAY *import* from
  `src/health-services/` read-only — see the status-bar note below — but never edit.)
- **`scripts/`, `tests/`, `drizzle/`** — verification harnesses and migrations.
- **`package.json` deps / `tsconfig` / `next.config`** — no new heavy deps; TypeScript stays
  pinned `^5` (TS 7 breaks the Vercel build); Node runtime everywhere; no Tailwind install.
- **In the files you DO edit, these behaviors are load-bearing:**
  1. `app/sign-in/page.tsx` — the **authorize-resume logic** (~lines 40–42): when the MCP flow
     redirects here with `client_id` etc. in the query, post-login `callbackURL` must be
     `/api/auth/mcp/authorize?<the original query>`. Every connector login runs through this.
     Also keep the `authClient.signIn.social` call and the `Suspense` wrapper
     (`useSearchParams` requires it).
  2. `app/page.tsx` — stays a **server component**; keep the `?health=` / `?health_error=`
     banner handling (`HEALTH_ERROR_MESSAGES` keys) and the Connect/Reconnect control as a
     plain anchor to `/api/auth/google-health/start` (server redirect — no fetch()).
  3. Sign-out must keep working (`app/components/sign-out-button.tsx` is a client component).

## YOUR canvas (the only files to restyle, plus new UI-only files you add)

- `app/layout.tsx` — fonts (CDN @font-face — nothing is actually loaded today, the mono stack
  silently falls back), favicon pair, metadata, page chrome. Centered, no nav-bar.
- `app/page.tsx` — signed-out marketing+login state; signed-in MCP-profile state per the spec.
- `app/sign-in/page.tsx` — restyle around the invariant logic.
- `app/components/sign-out-button.tsx` — match the system.
- New UI-only components/CSS under `app/` as needed (inline styles or a small CSS file; there
  is currently no globals.css and no CSS framework).

**Status-bar implementation guidance (the one place UI meets the backend):** connection status
(`active`/`reauth_required`/none), granted-scope count, and `connectedAt` already come cheap
from the DB (`getAppUserByEmail` + `getConnection`, exactly as `app/page.tsx` does now). The
**last-synced time** (`syncedThrough`) lives in `src/health-services/status.ts`
(`getSyncStatus(user, client)`) — it makes 2–3 Google API calls, so don't block first paint on
it: render the shell, wrap the sync detail in a **`<Suspense>`-streamed async server
component** (App Router streaming works on Vercel), with `<shaughv-loader>` as the fallback.
Degrade gracefully when not connected / reauth-required (the service throws typed errors —
catch and show the status pill state instead). Read-only imports; do not modify the service.

## Verification (build your `.tasks/tasks/7le.md` checklist from this)

- `npm run typecheck` · `npm test` (67 tests) · `npm run build` all green.
- `npm run dev` (Bash tool or PowerShell `run_in_background`; plain `Start-Process npm` fails
  on this box) and visually check all states: signed-out home, /sign-in, signed-in dashboard
  (Emmett can click the signed-in state if you can't). Prefer Claude-in-Chrome MCP tools for
  browser checks (Emmett's global preference).
- **Auth-flow regression gate:** `npx tsx scripts/live-verify-e2e.ts http://localhost:3000`
  with the dev server running — full DCR → authorize → token → MCP chain must stay ALL-PASS.
  It exercises the authorize *endpoint*, not the /sign-in page UI — so also click-test that a
  sign-in with `client_id` in the query resumes to the authorize endpoint.
- After deploy: `https://health.emmetts.dev/api/health/status` → 200; homepage renders
  on-brand; `npx tsx scripts/live-verify-e2e.ts` (prod default) still passes.
- Codex install command shown on the page was verified against current Codex docs.
- Emmett approves the look (taste sign-off is his).

## Deploy & Board Mechanics

- Commit to `main` and push (repo convention — direct-to-main, per-task commits; the board is
  git-tracked: pull before, commit board changes after, attribute Activity lines).
- Push → Vercel auto-deploy, **but watch it**: the webhook silently skipped one push before.
  Vercel CLI is NOT installed; use the Vercel MCP tools (`list_deployments`,
  `get_deployment_build_logs`, `deploy_to_vercel`) or the `vercel:deploy` skill if needed.
  Project: `google-health-mcp` (prj_hZe49opI8FWMx8fWnGDbNI34zUzo, team realemmetts).
- Deployment Protection must STAY preview-only (prod open; the app brings its own auth).

## Key Decisions Already Made (do not re-litigate)

- mcp-handler + better-auth built-in `mcp` plugin, NOT FastMCP (revisit only under #rlw).
- `BETTER_AUTH_SECRET` deliberately split local≠prod — do NOT align. `TOKEN_ENCRYPTION_KEY`
  deliberately shared — do NOT rotate (orphans all stored Google tokens).
- `update_profile` tool dropped (Google-side 403 bug); nutrition update = replace semantics
  (Google-side PATCH 500 bug). Documented in `.tasks/tasks/p6w.md`.
- No consent page exists or is needed (better-auth auto-issues codes post-login).

## Important Context

- Secrets: `.env.development.local` + `.tasks/secure/` (both gitignored). Never in board files
  or commits. Vercel env vars are Sensitive/write-only (`vercel env pull` returns empty).
- Live board port: resolve from `.tasks/.board-server.json` — never assume it.
- Emmett's connector is live in claude.ai **right now**; prod breakage is user-visible
  immediately. The e2e regression gate exists precisely for this.

## What's Next (after #7le, not yours unless asked)

Emmett-owned: ChatGPT + claude.ai-mobile connector adds; refresh-token recheck ~2026-07-17.
Backlog, Emmett's call: #w11 webhooks (v1.1) · #api REST/PAT surface · #rlw Railway evaluation.
