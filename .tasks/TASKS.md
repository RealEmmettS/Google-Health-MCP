# Tasks

## Backlog
- [ ] **Custom REST API surface (future, Emmett's call)** - bearer-token (PAT) authenticated standard API over the same health services, alongside the MCP (needs #p7d) #api

## To-Do
- [ ] **Qualify and release v1.1** - migrations, full test/build gates, real connector reads, real Fitbit webhook, deployment, and rollback evidence (needs #fsp, #prv, #w11, #qry, #upd) (ms #v11) (owner agent+emmett) #q11

## Active
- [ ] **Upgrade to native MCP SDK v2 and Vercel Fluid** - ship rollback-safe 0.2.1 with 2026 request-scoped transport, stateless legacy compatibility, structured contracts, privacy-safe telemetry, and Node 24 in iad1 (ms #mcp2) (owner agent) #sdk2
- [ ] **Migrate MCP auth off Better Auth's deprecated legacy plugin** - additive stable OAuth Provider/JWT cutover, hashed rotating refresh tokens, allowlist-safe local bearer verification, Google Health DPoP, and one coordinated connector re-auth (ms #mcp2) (owner agent+emmett) #oap
  - [x] Repair Hermes/Claude Code/Codex offline continuity without weakening callback validation
  - [x] Publish MCP identity/tool OAuth metadata and audit ChatGPT's connector-versus-plugin install state
- [ ] **Apply branded MCP consent typography** - use live SHAUGHV CDN Makira/Gail Rock assets on the website and new private OAuth consent flow (ms #mcp2) (owner agent) #font2
  - [x] Rebalance public, signed-in, and consent scale with desktop/mobile viewport proof
  - [x] Raise utility and consent typography while preserving the signed-out and first-card viewport targets
  - [x] Distinguish signed-in site scale from browser zoom and restore the owner view to 100%
  - [x] Remove the decorative green rail from every public, signed-in, and consent panel
  - [x] Lock the consent sheet to a no-scroll 100vw × 100dvh composition across portrait and landscape
- [ ] **Qualify and release Google Health MCP 1.0.0** - promote the proven SDK v2 line to stable, reconnect every active connector, prove Google DPoP refresh, and complete the 24-hour/seven-day soak without closing unrelated physical gates (needs #sdk2, #oap, #font2) (ms #mcp2) (owner agent+emmett) #q2
  - [ ] Reauthenticate affected desktop clients once and prove rotating refresh issuance (owner emmett+agent)
- [ ] **v1.1 — Google Health webhooks** - authenticated subscriber, signature verification, durable freshness ledger, and encrypted-cache invalidation (needs #fsp) (ms #v11) (owner agent+emmett) #w11
- [ ] **Add proactive health update inbox** - turn webhook signals into deduplicated MCP-readable updates without claiming outbound push (needs #w11, #qry) (ms #v11) (owner agent) #upd
- [ ] **Resolve Claude work-computer OAuth handoff failure** - 0.1.3 is live; fresh native Claude Code + Codex auth/tool calls and exact callback/refresh profiles pass, awaiting the intended work workspace retry (owner emmett+agent) #cau
  - [x] Extend OAuth E2E coverage for signed-out parameter preservation + public PKCE clients
  - [x] Exercise exact hosted Claude, direct Claude Code, and Codex callback profiles plus refresh grants
  - [x] Complete fresh native Claude Code and Codex logins and read-only production tool calls
  - [x] Record the safe Claude remote-connector reset and diagnostic decision path
  - [x] Verify unit tests, typecheck, build, OAuth paths, production metadata, and test-row cleanup
  - [x] Deploy 0.1.3 and verify live refresh headers plus post-refresh MCP use
  - [ ] Reconnect once from the intended work Claude workspace and run a read-only Health tool (owner emmett)
  - [ ] Confirm the account-level connector propagates to Claude Desktop and Claude Code (owner emmett)

## Done
- [x] **Evaluate Railway migration and choose the MCP 2026 host** - retained Vercel Node 24 + Fluid in iad1 after documented Edge, Cloudflare, Railway, locality, compatibility, cost, and reevaluation analysis (done 2026-07-29) #rlw
- [x] **Add bounded health trends** - structured 7/30/90-day coverage-aware trends without medical interpretation (done 2026-07-25) (needs #fsp) (ms #v11) (owner agent) #qry
- [x] **Make the MCP single-user and add health-data controls** - removed Christian everywhere, verified no access/stored rows existed, published privacy disclosure, and added disconnect/delete actions (done 2026-07-25) (ms #v11) (owner agent+emmett) #prv
  - [x] Remove Christian from code, docs, task memory, and production allowlist
  - [x] Revoke Christian's MCP sessions/tokens and Google Health connection
  - [x] Delete Christian's locally stored Health data and verify isolation
  - [x] Add privacy, disconnect, and Health-data deletion controls
- [x] **Add encrypted health cache and faster truthful reads** - exact-response AES-256-GCM cache, request dedupe/concurrency, invalidation, provenance, and freshness fixes (done 2026-07-25) (ms #v11) (owner agent) #fsp
  - [x] Add encrypted exact-response cache with range-aware TTLs
  - [x] Add request-scoped deduplication and bounded concurrency
  - [x] Correct rollup/context/sync freshness and cache provenance
  - [x] Add retry deadlines and payload-free timing telemetry
- [x] **Fix mobile homepage headline overflow** - “HEALTH, CONNECTED.” now stays comfortably inside the hero panel with no narrow-viewport horizontal scroll (done 2026-07-10) #mbl
- [x] **use /shaughv-design + /shaughv-cdn to make health.emmetts.dev on-brand and presentable** - Emmett's spec: marketing+login → signed-in MCP profile (no health data); keep big Connect/Reconnect button + status bar w/ last-sync; add copyable raw MCP URL + Codex install command; centered, no nav-bar. READ docs/agents/handoff/2026-07-09-003-* first (spec + DO-NOT-TOUCH list)  (done 2026-07-10) (needs #p7d) #7le
- [x] **Connector-feedback fixes — daily filter, sleep dedupe/stagesStatus, cadence-aware staleness** - daily-* types now honor startTime via civil-date filter (was silent no-op, live-verified); stagesSummary deduped + stagesStatus surfaced w/ CLASSIC explanation; isPossiblyStale daily-aware; reconcile + ECG/IRN notes recorded; 74/74 tests (done 2026-07-09) #fb1
- [x] **Surface sleepType + stages-algorithm status in the sleep tool** - research verdict: Google Health API v4 IS the only cloud surface for a Google-account Fitbit Air (no better sleep API; sleep score not exposed anywhere; legacy Web API sunsets Sept 2026; Health Connect on-device; Google Fit REST EOL end-2026; CLASSIC = device-side capture failure). Actionable shipped in #fb1: `type` + NEW `stagesStatus` + explanatory freshness note; `daily-resting-heart-rate` confirmed in registry (done 2026-07-09) #slp
- [x] **Phase 7 — Deploy + wire clients** - VERIFIED WITH A REAL CLIENT: "Shaughv Health" connector added + live session ran the battery through the real connector OAuth path (reads w/ real data, nutrition+hydration write roundtrips cleaned up); headless E2E green on localhost+prod (scripts/live-verify-e2e.ts, form-encoding #313 cleared, unauth 401). Non-blockers on Emmett: ChatGPT/mobile adds, ~1-week refresh recheck    (done 2026-07-09) (needs #p6w) (ms #v1) (owner emmett+agent) #p7d
- [x] **Phase 6 — Write tools + audit logging** - nutrition create/update(replace)/delete, hydration, measurements; update_profile dropped (live API 403 bug); 21/21 live roundtrips + audit rows   (done 2026-07-09) (needs #p5m) (ms #v1) #p6w
- [x] **Phase 5 — MCP endpoint + read tools + resources** - 9 read tools + 5 resources + freshness, thin handlers over src/health-services/; 11/11 live service checks vs real data   (done 2026-07-09) (needs #p4g) (ms #v1) #p5m
- [x] **Phase 3 — Google Health consent + token lifecycle** - start/callback routes, encrypted token store, identity mapping, single-flight refresh; live smoke passed (real steps)   (done 2026-07-09) (needs #p2a) (ms #v1) #p3c
- [x] **Onboarding docs — README, CLAUDE.md, AGENTS.md** - exhaustive front-door + agent (incl. Codex) instructions: what/why/intent, architecture, setup, security, troubleshooting, decisions, watchouts, and task-board usage; sourced from docs/PLAN.md + board  (done 2026-07-09) #3m3
- [x] **Phase 4 — Google Health API client** - registry (41 types), client with scope prechecks/401-retry/429-backoff, Luxon time utils, 65 tests   (done 2026-07-09) (needs #p3c) (ms #v1) #p4g
- [x] **Phase 2 — MCP client auth (better-auth OAuth 2.1 + DCR)** - Google sign-in locked to allowlist, well-known metadata routes, landing/dashboard pages   (done 2026-07-09) (needs #p1d) (ms #v1) #p2a
  - [x] better-auth config: Drizzle adapter, Google provider, mcp plugin, DCR on, dual allowlist hooks
  - [x] Well-known metadata + auth catch-all routes live and spec-valid (verified via curl)
  - [x] DCR registration + authorize→/sign-in redirect verified end-to-end locally
  - [x] Landing/dashboard/sign-in pages (subagent) + authorize-resume fix
  - [x] Live Google sign-in on prod (Emmett's 30-second click test)
  - [x] Prod deploy serves metadata with https://health.emmetts.dev issuer (+ DCR & authorize verified on prod)
- [x] **Phase 1 — DB schema + security foundation** - Drizzle schema (all tables), migrations to Neon, AES-256-GCM token encryption, redaction helper, audit service   (done 2026-07-09) (needs #p0b) (ms #v1) #p1d
- [x] **Infra + operator setup — Vercel, Google OAuth client, Neon, domains** - project live on health.emmetts.dev, client wired, env complete, app published  (done 2026-07-09) (ms #v1) #inf
- [x] **Phase 0 — Bootstrap repo + task system** - task board, Next.js scaffold, deps, env files, README, docs/PLAN.md  (done 2026-07-09) (ms #v1) #p0b
  - [x] Task board scaffolded (board live, hooks installed, repo CLAUDE.md section)
  - [x] Plan copied to docs/PLAN.md
  - [x] Next.js app scaffold + all deps installed
  - [x] .env.example + .env.development.local (gitignored) + README skeleton
  - [x] App boots locally (dev server responds)
  - [x] Initial commit pushed to origin/main
