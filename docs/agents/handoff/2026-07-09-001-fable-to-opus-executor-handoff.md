# Handoff: Fable 5 → Opus 4.8 Executor Handoff — shaughv-health-mcp (Phases 0–4 done, 5–7 remaining)

**Date:** 2026-07-09
**Session:** Session 1 of the day
**Agent:** Claude Code (Fable 5, planning + Phases 0–4)
**Task/ticket ID(s):** Board milestone `#v1`; tasks `#inf #p0b #p1d #p2a #p3c #p4g` (done), `#p5m #p6w #p7d` (remaining), `#w11 #rlw #api #7le` (backlog/queued)

---

## Session Narrative

Emmett asked for a **private remote MCP server on Vercel** exposing his Google Health / Fitbit Air data to his LLM assistants — reads for activity/sleep/heart/nutrition ("How many steps today?", "Why am I tired?"), writes for nutrition/hydration/measurements only (never sleep/exercise/settings). Fable planned it (plan approved → `docs/PLAN.md`), then Emmett kept Fable in the seat through Phases 0–4 ("the super critical point"), with instructions to subagent-out the simple parts. This handoff marks the agreed executor switch to Opus 4.8.

Key mid-flight evolutions (all recorded on the board):
- MCP auth went from bearer-token thinking to **full OAuth 2.1 + DCR with Google-federated login** (Emmett: all of Claude Code/Desktop, claude.ai web+mobile, ChatGPT must connect; claude.ai/ChatGPT don't support static bearer).
- **Webhooks deferred to v1.1** after a value analysis (payloads carry pointers, not values; on-demand fetch suffices for Q&A). Tables exist, dormant.
- Infra was pulled forward from Phase 7: Vercel project, Neon connect, Google client (6 redirect URIs), app **published to production** (kills 7-day refresh-token expiry), custom domain **health.emmetts.dev** (canonical). Recorded as `#inf`.
- Emmett rejected FastMCP (stack stays mcp-handler; reopens only under `#rlw` Railway migration), parked a REST-API idea (`#api`, Opus-analyzed FEASIBLE), added Christian (email since redacted) to the allowlist, and queued a design task (`#7le`, gated on `#p7d`).
- Live verification milestones: Emmett's Google sign-in on prod (closed `#p2a`), then health-scopes consent + reconnect (closed `#p3c`), and a **live smoke test returning his real steps (32, 2026-07-09)** through the full encrypted-token pipeline.

Dead ends / incidents (don't repeat):
- `typescript@7` broke the Vercel build (Next 16 can't load it) → pinned `^5`.
- Vercel **Deployment Protection** silently SSO-walled production → set to preview-only; must stay off production.
- **Split encryption keys** (local vs prod) over the ONE shared Neon DB made prod tokens locally undecryptable → rotated to a single shared `TOKEN_ENCRYPTION_KEY`; Emmett reconnected once. Rotating this key orphans all stored Google tokens.
- Vercel env vars on this project are **Sensitive = write-only**; `vercel env pull` returns them EMPTY. Canonical secrets live in `.env.development.local` (gitignored) + `.tasks/secure/`.
- The auto-deploy webhook didn't fire on one push (`8dd5fa9`) — deploys have been done via `npx vercel deploy --prod --yes`; check whether git-push auto-deploy works now.

## The Plan & Where It Stands

Plan: `docs/PLAN.md` (source of truth; overrides the ChatGPT handoff spec in `C:\Users\hey\Downloads\shaughv-health-mcp_handoff_spec_v2.md`). Live status: `.tasks/` board.

- **Phase 0 bootstrap** — DONE (`#p0b`)
- **Infra/operator setup** — DONE (`#inf`; all operator dependencies for Phases 5–6 cleared)
- **Phase 1 DB + security** — DONE (`#p1d`; 15 tables in Neon, AES-256-GCM, redaction, audit service)
- **Phase 2 MCP OAuth AS** — DONE (`#p2a`; live sign-in verified on prod)
- **Phase 3 health consent + tokens** — DONE (`#p3c`; live smoke passed with real data)
- **Phase 4 Google Health client** — DONE (`#p4g`; 65 tests)
- **Docs** — DONE (`#3m3`; README / CLAUDE.md / AGENTS.md, opus subagent)
- **Phase 5 MCP endpoint + read tools + resources** — NOT STARTED (`#p5m`) ← **next**
- **Phase 6 write tools + audit** — NOT STARTED (`#p6w`)
- **Phase 7 client wiring + E2E battery** — NOT STARTED (`#p7d`; partially pre-completed — see its detail file)
- Backlog: `#w11` webhooks v1.1 · `#rlw` Railway (dormant) · `#api` REST surface (dormant) · `#7le` SHAUGHV design pass (queued, needs `#p7d`)

## What Was Accomplished

Live system at **https://health.emmetts.dev** (Vercel project `google-health-mcp`, team `realemmetts`; also serves `google-health-mcp-realemmetts.vercel.app`):
- OAuth 2.1 authorization server (better-auth built-in `mcp` plugin): DCR at `/api/auth/mcp/register`, authorize/token/jwks/userinfo under `/api/auth/mcp/*`, RFC 8414 + 9728 metadata at `/.well-known/*` — all verified on prod, including a real DCR registration and authorize→login redirect.
- Google sign-in locked to `ALLOWED_GOOGLE_EMAILS` (Emmett's two aliases and one since-removed private identity, now redacted), enforced at user-create AND session-create, fail-closed.
- Google Health consent flow with single-use hashed state, encrypted token storage (upsert, never duplicate), identity mapping (healthUserId `455803974908071566`, legacy `C8QFBG`), refresh with claimable single-flight lock.
- Dashboard (`/`) with live connection status + Connect/Reconnect; sign-in page that resumes interrupted MCP authorize flows.
- `GoogleHealthClient` (`src/google-health/client.ts`): registry-driven scope prechecks, list/reconcile/get/rollUp/dailyRollUp/create/patch/batchDelete, 401→forced-refresh retry, 429 backoff, pageSize cap 100. Registry: `src/google-health/registry.ts` (41 data types). Time utils: `src/time/ranges.ts` (DST-safe, civil-vs-physical).
- Security core: `src/security/encryption.ts` (AES-256-GCM, key versioning), `src/security/redact.ts`, `src/audit/mutation-audit.ts`.
- 65 passing tests (`tests/unit/*`), typecheck clean, prod builds green.
- Utilities: `scripts/gh-smoke.ts` (live end-to-end check — run after any auth/token change), `scripts/db-inspect.mjs`.
- Docs: `README.md`, `CLAUDE.md`, `AGENTS.md` (comprehensive, cross-referenced).
- Board: `.tasks/` (git-tracked, hooks in `.claude/settings.json`, server on **port 4321** — always resolve from `.tasks/.board-server.json`).

## Key Decisions

All recorded in `CLAUDE.md` §"Recorded decisions" and `.tasks/CLAUDE.md`; headlines:
- **mcp-handler + official SDK, NOT FastMCP** (serverless + auth-integration reasons; reopens only under `#rlw`).
- **better-auth 1.6.23 BUILT-IN `mcp` plugin**, not `@better-auth/mcp` (targets unreleased 1.7; was removed from deps).
- **One shared `TOKEN_ENCRYPTION_KEY`** across local+prod (one shared DB = one key).
- **TypeScript pinned `^5`** (Next 16 can't load TS 7).
- **Webhooks v1.1**; freshness ledger stores notification metadata, never values.
- **zod 4.4 is installed** — mcp-handler tool-schema compat is UNVERIFIED (flagged for Phase 5; if `registerTool` fights zod 4, pin `zod@^3.25`).
- Deployment Protection preview-only; production stays open (app brings its own auth).
- Subagent policy (global): Opus 4.8 xhigh (or max) / Sonnet 5 max (or xhigh); never lower, never Haiku.

## How It Works

Request path: MCP client OAuth-dances against this app's own AS (DCR → authorize → Google login → token), then calls `/api/mcp` (Phase 5 will create it at `app/api/[transport]/route.ts`, basePath `/api`). Tool handlers resolve app_user from the verified session, call `GoogleHealthClient(appUserId)` which pulls a decrypted-on-demand access token via `getValidAccessToken` (auto-refresh), hits `health.googleapis.com/v4`, and returns bounded data + freshness metadata. better-auth's `withMcpAuth(auth, handler)` (from `better-auth/plugins`) wraps the route and 401s with WWW-Authenticate pointing at the protected-resource metadata. DB: Drizzle + neon-http (pooled URL runtime, unpooled for `npm run db:migrate`; NO interactive transactions — single-statement atomicity only).

## Known Issues & Limitations

- ~~Consent step for OAuth clients unexercised~~ **RESOLVED — see Addendum.** No consent page needed, ever, on this plugin version.
- ~~zod 4 vs mcp-handler compat unverified~~ **RESOLVED — see Addendum.** Compatible; no pin needed.
- `getProfile()`/`getSettings()` client paths (`/users/me/profile`, `/users/me/settings`) are UNVERIFIED against the live v4 REST reference — verify before shipping the profile/settings resources and `update_profile` (drop the tool if no writable endpoint exists; do not invent fields).
- Auto-deploy-on-push unverified (see narrative); manual `npx vercel deploy --prod --yes` is the known-good path.
- Local `next build` prints BetterAuthError secret warnings (env not loaded at build locally) — cosmetic; exit 0 is what matters.
- Board quirk: multi-line task titles pasted into the dashboard get re-serialized oddly (the `#3m3`/`#sgb` episode); keep titles one-line.
- `#7le` design task: dashboard restyle with `/shaughv-design`, gated on `#p7d`.

## Important Context for Future Sessions

- **Read first:** `docs/PLAN.md` → `CLAUDE.md` → `.tasks/TASKS.md` + the Active/next task's `.tasks/tasks/<id>.md`. `AGENTS.md` for non-Claude agents.
- **Branch:** everything is on `main` (Emmett-approved phase-commit workflow; commits end with the Claude trailer). Working tree should be clean at handoff.
- **Env:** `.env.development.local` (gitignored) holds all real values incl. the shared TOKEN_ENCRYPTION_KEY and Neon URLs; `.env.example` documents names. Google client JSON archived at `.tasks/secure/google-oauth-client.json`. Vercel env is write-only (Sensitive).
- **DB:** ONE Neon database (`shaughv-health-db`) shared by local dev and prod — local runs touch production data; be deliberate (especially anything writing `oauth_*` rows — a careless local write can break the prod connection).
- **Verification bar:** every phase task has a `## Verification` checklist the board enforces; `docs/PLAN.md` §"Verification / E2E" is the v1 definition of done, including the prompt battery and negative checks.
- **Deploy:** `npx vercel deploy --prod --yes` (CLI authed as `shaughv`). Migrations: `npm run db:migrate` from the dev box.
- **Smoke:** `npx tsx scripts/gh-smoke.ts` any time auth/token code changes — it proves the whole pipeline in ~5s.
- Emmett is hands-on and fast on his operator steps; batch asks, give exact URLs/clicks. Never send anything outward without fresh per-message approval (global rule).

## What's Next

1. **Phase 5 (`#p5m`) — start here, from a WORKING skeleton.** The MCP endpoint already exists and 401s correctly (see Addendum). Exact first actions: move `#p5m` to Active; re-read `.tasks/tasks/p5m.md` (risk resolutions + the session.userId→app_user note + the service-layer rule: handlers THIN, orchestration in `src/health-services/` so the future `#api` REST surface reuses it); then grow `src/mcp/register-tools.ts` into the 9 read tools + 5 resources per `docs/PLAN.md` §"MCP surface" (exact input schemas in handoff spec §11 / plan).
2. **Test with MCP Inspector** (`npx @modelcontextprotocol/inspector`) against localhost AND prod — the OAuth dance should now complete without any consent snag (verified at source level; Inspector run is the live confirmation).
3. **Phase 6 (`#p6w`)**: write tools + audit; verify `update_profile` feasibility against the live REST reference first.
4. **Phase 7 (`#p7d`)**: real-client wiring (Claude Code → claude.ai EARLY (token-endpoint form-encoding quirk) → ChatGPT) + the full prompt battery + negative checks. Emmett steps: adding connectors in each client.
5. Then: `#7le` design pass, and Emmett decides on `#w11`/`#api`/`#rlw`.

---

## Addendum (same session, post-handoff-doc): Phase 5 risk checks — BOTH CLEARED

At Emmett's direction, Fable ran the two flagged Phase 5 risk checks before the executor switch:

**1. OAuth consent step — no consent page needed (source-verified).** better-auth 1.6.23's mcp plugin uses its OWN authorize handler (`node_modules/better-auth/dist/plugins/mcp/authorize.mjs`), not the oidc-provider one. Behavior: after login it issues the authorization code immediately — a consent step only occurs if the CLIENT sends `prompt=consent`, and even then, without a configured consentPage it falls through and issues the code anyway; the token endpoint never checks the stored `requireConsent` flag. Conclusion: for this private single-user server the flow "login → code → token" is complete as-built. **Do not build a /consent page.**

**2. zod 4 + mcp-handler — compatible (spike-proven).** `tests/unit/mcp-handler-spike.test.ts` drives the real `createMcpHandler` with raw JSON-RPC over streamable HTTP: initialize → tools/list shows the zod-4 shape converted to real JSON Schema (`properties.echo`) → tools/call executes → invalid arguments are rejected. **No zod pin needed** (zod stays at 4.4).

**Landed in the same pass (commit contains):**
- `app/api/[transport]/route.ts` — the real MCP endpoint: `withMcpAuth(auth, …)` (better-auth) wrapping `createMcpHandler` (mcp-handler), Node runtime, maxDuration 60. Verified live: unauthenticated POST `/api/mcp` → **401 + `WWW-Authenticate: Bearer resource_metadata="…/api/auth/.well-known/oauth-protected-resource"`**; protected-resource metadata serves at BOTH the header-advertised `/api/auth/.well-known/...` path and the root `/.well-known/...` routes.
- `src/mcp/register-tools.ts` — registration seam + permanent `ping` diagnostic tool (echoes authenticated userId). **Phase 5 grows this file; don't rewrite the route.**
- **MCP refresh-token window raised to 60 days rolling** (`refreshTokenExpiresIn` in `src/auth/auth.ts` oidcConfig; plugin default was 7d; tokens re-issue on every refresh) — implements Emmett's stated intent: *"I connect the MCP server to my LLM once, and I don't have to go re-auth all the time."* Any use within 60 days = never re-auth; Google-side re-auth is already permanent (published app + auto-refresh).
- Suite: 67/67 tests, typecheck + prod build clean. Deployed to production and 401-verified there.
- Note for tool authors: `withMcpAuth` passes the ACCESS-TOKEN record; `session.userId` is the better-auth user id — resolve the domain `app_users` row via the better-auth user's email (helper needed in Phase 5).
