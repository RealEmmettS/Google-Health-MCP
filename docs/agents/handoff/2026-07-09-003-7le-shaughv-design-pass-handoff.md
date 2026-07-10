# Handoff: #7le — SHAUGHV design pass on health.emmetts.dev

**Date:** 2026-07-09
**Session:** Session 3 of the day (written by the v1-completion session, for the NEXT agent)
**Agent:** Claude Code (Fable 5)
**Task/ticket ID(s):** #7le (To-Do → yours to move to Active)

---

## Session Narrative

This handoff exists because Emmett said, verbatim, "leave 7le for the next agent actually …
but produce a solid /handoff for the agent for 7le based on everything we've talked about."
You are that agent. Context in brief: v1 of this private Google Health MCP server is **done,
live, and closed** — milestone #v1 shut 2026-07-09 with all nine phase tasks complete. The
final gate (#p7d) closed today when Emmett added the "Shaughv Health" connector to claude.ai
and a live Claude session verified every tool through the real connector OAuth path (real
reads: 4,563 steps, sleep 333 min, HR 90/resting 77, five workouts; write roundtrips:
nutrition and hydration entries created → read back → deleted clean). The headless full-chain
E2E (`scripts/live-verify-e2e.ts`) is green against both localhost and prod.

What's left on the board for you is **#7le, the design task**: the functional pages shipped
with placeholder styling; Emmett wants the site to actually look like SHAUGHV.

## The Task (Emmett's words)

> "use /shaughv-design to make the health.emmetts.dev on-brand and presentable" —
> "centered on screen is preferred, no nav-bar required"

**First actions, in order:**
1. `git pull` (shared git-tracked board), move #7le from To-Do → Active in `.tasks/TASKS.md`.
2. Invoke the **`shaughv-code:shaughv-design`** skill (the task names it explicitly) — it holds
   the brand's typography, palette, fonts, mark, motion vocabulary, and two full UI kits
   (brutalist live-site + vintage edition). Pick the direction it recommends for a utility
   dashboard; when in doubt, match the live brutalist personal-site kit.
3. Also invoke **`shaughv-code:shaughv-cdn`** before embedding any brand asset or font — all
   SHAUGHV assets (logos, favicons, Makira/Unbounded/IBM Plex Mono fonts, the animated brand
   mark drop-in) come from `cdn.shaughv.com`, discovered via its `/tree.json` manifest.
   **Never hardcode CDN paths; never inline your own copies of brand fonts.**
   `shaughv-code:shaughv-animated-brandmark` exists too if a hero mark fits the design.

## The Surface to Restyle (all of it — 4 small files, inline styles, no CSS framework)

There is **no Tailwind, no globals.css, no CSS modules** — everything is inline `style={}`
today. You may keep inline styles or introduce a small CSS file; do NOT add heavy deps.

- **`app/layout.tsx`** — root layout. Body: IBM Plex Mono font-*stack* (the font is NOT
  actually loaded — no @font-face anywhere, so most visitors get fallback monospace; the CDN
  skill fixes this properly), `#0d0d0d` background, `#f2f2f2` text, `2rem` padding. Metadata
  title `shaughv-health-mcp`. No favicon is set — the CDN has the brand favicons.
- **`app/page.tsx`** — server component, TWO states:
  - **Signed-out:** H1 "SHAUGHV HEALTH MCP", one-line blurb, "Sign in with Google" button
    (`<a href="/sign-in">`), allowlist note.
  - **Signed-in dashboard:** signed-in-as line + `SignOutButton`; "Google Health connection"
    section — `StatusPill` (Connected `#7fd8b4` / Reauth needed `#f2d8a5` / Not connected
    `#f2b8b5`), success/error banners driven by `?health=connected` / `?health_error=<key>`
    query params (keys in `HEALTH_ERROR_MESSAGES`), Connect/Reconnect button →
    `/api/auth/google-health/start`; "MCP endpoint" section — the endpoint URL in a code
    block + client-setup instructions for Claude Code / claude.ai / ChatGPT.
- **`app/sign-in/page.tsx`** — client component with **the one piece of load-bearing logic
  in the whole UI** (lines ~40–42): when better-auth's MCP authorize flow needs a login it
  redirects here with the ORIGINAL authorize query (client_id, redirect_uri, state,
  code_challenge…), and after Google sign-in the page must send the user back to
  `/api/auth/mcp/authorize?<that exact query>` so the flow resumes and issues the code.
  `?error` shows the private-server/allowlist message. **Restyle freely; do not touch the
  `callbackURL` logic, the `authClient.signIn.social` call, or the Suspense wrapper**
  (`useSearchParams` requires it).
- **`app/components/sign-out-button.tsx`** — tiny client component; restyle to match.

**Current placeholder palette** (replace with the real brand kit's): `#0d0d0d` bg, `#f2f2f2`
text, `#7fd8b4` mint accent, `#f2b8b5` red, `#f2d8a5` amber, monospace everywhere.

## Functional Invariants (break none of these)

1. Sign-in **authorize-resume logic** (above) — Emmett's live claude.ai connector and every
   future connector-add depends on it.
2. The Connect button must remain a plain link/anchor to `/api/auth/google-health/start`
   (server redirect; no fetch).
3. The `?health=` / `?health_error=` banner handling on the dashboard.
4. `page.tsx` stays a **server component** (it calls `auth.api.getSession`,
   `getAppUserByEmail`, `getConnection`); `sign-in/page.tsx` stays a client component.
5. Touch **nothing** under `app/api/`, `app/.well-known/`, or `src/` — this task is purely
   the human-facing pages. The MCP surface is live and in use.
6. TypeScript stays pinned `^5` (TS 7 breaks the Vercel build). Next 16.2.10 / React 19.
7. Cross-platform npm scripts only (Windows dev box).

## Verification (build your `.tasks/tasks/7le.md` checklist from this)

- `npm run typecheck` · `npm test` (67 tests) · `npm run build` all green.
- `npm run dev` (Bash tool or PowerShell `run_in_background`; plain `Start-Process npm` fails
  on this box) and visually check all states: signed-out home, /sign-in, and the signed-in
  dashboard. Prefer the Claude-in-Chrome MCP tools for browser work (Emmett's global pref);
  Emmett can click through the signed-in state if you can't.
- **Auth-flow regression check:** `npx tsx scripts/live-verify-e2e.ts http://localhost:3000`
  with the dev server running — it drives DCR → authorize → token → MCP calls and must stay
  ALL-PASS. (Against prod it uses a fallback path; localhost is the full chain.) Note it
  exercises the authorize endpoint, NOT the /sign-in page UI — hence the click test too.
- After deploy: `https://health.emmetts.dev/api/health/status` → 200, homepage renders
  on-brand, and `npx tsx scripts/live-verify-e2e.ts` (prod default) still passes.
- Emmett approves the look (he wrote the task; taste-approval is his).

## Deploy & Board Mechanics

- Commit to `main` and push (repo convention — direct-to-main, per-task commits, this board
  is git-tracked: pull before, commit board changes after; attribute Activity lines).
- Push → Vercel auto-deploy, **but watch it**: the webhook silently skipped one push before
  (8dd5fa9). Vercel CLI is NOT installed; use the Vercel MCP tools (`list_deployments`,
  `get_deployment_build_logs`, `deploy_to_vercel`) or the `vercel:deploy` skill if you must
  deploy manually. Project: `google-health-mcp` (prj_hZe49opI8FWMx8fWnGDbNI34zUzo, team
  realemmetts).
- Deployment Protection must STAY preview-only (prod open; the app brings its own auth).

## Key Decisions Already Made (do not re-litigate)

- mcp-handler + better-auth built-in `mcp` plugin, NOT FastMCP (revisit only under #rlw).
- `BETTER_AUTH_SECRET` is deliberately split local≠prod — do NOT align it.
  `TOKEN_ENCRYPTION_KEY` is deliberately shared — do NOT rotate it (orphans all tokens).
- `update_profile` tool dropped (Google-side 403 bug); nutrition update = replace semantics
  (Google-side PATCH 500 bug). Both documented in `.tasks/tasks/p6w.md`.
- No consent page exists or is needed (plugin auto-issues codes post-login, source-verified).

## Important Context

- Full project rules: repo `CLAUDE.md` (agents) / `README.md` (humans) / `docs/PLAN.md`
  (source of truth). Working memory: `.tasks/CLAUDE.md`. Prior handoffs in this folder
  (001 = architecture/executor context, 002 = Phase 7 E2E close-out).
- Live board: resolve the port from `.tasks/.board-server.json` — never assume it.
- Emmett's connector ("Shaughv Health") is live in claude.ai right now; prod breakage is
  user-visible immediately.
- Secrets: `.env.development.local` + `.tasks/secure/` (both gitignored). Never in board
  files or commits.

## What's Next (after #7le, not yours unless asked)

Emmett-owned: ChatGPT + claude.ai-mobile connector adds; refresh-token recheck ~2026-07-17.
Backlog, Emmett's call: #w11 webhooks (v1.1) · #api REST/PAT surface · #rlw Railway evaluation.
