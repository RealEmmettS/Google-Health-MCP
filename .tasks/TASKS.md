# Tasks

## Backlog
- [ ] **v1.1 — Google Health webhooks** - service account + IAM, subscriber registration, signature verification, freshness ledger population; see docs/PLAN.md Phase 8 #w11
- [ ] **Evaluate Railway migration (future, Emmett's call)** - if/when leaving Vercel serverless; FastMCP becomes viable then; track Vercel-locked surface here #rlw
- [ ] **Custom REST API surface (future, Emmett's call)** - bearer-token (PAT) authenticated standard API over the same health services, alongside the MCP #api

## To-Do
- [ ] **Phase 5 — MCP endpoint + read tools + resources** - mcp-handler + withMcpAuth wiring, 9 read tools, 5 resources, freshness metadata, MCP Inspector pass (needs #p4g) (ms #v1) #p5m
- [ ] **Phase 6 — Write tools + audit logging** - nutrition CRUD, hydration, measurements, optional profile write, mutation audit rows (needs #p5m) (ms #v1) #p6w
- [ ] **Phase 7 — Deploy + wire clients** - Vercel import + Neon connect (Emmett), env vars, redirect URIs, publish OAuth app, E2E vs Claude Code / claude.ai / ChatGPT (needs #p6w) (ms #v1) (owner emmett+agent) #p7d
- [ ] **use /shaughv-design to make the health.emmetts.dev on-brand and presentable** - centered on screen is preferred, no nav-bar required (needs #p7d) #7le

## Active
- [ ] **Phase 3 — Google Health consent + token lifecycle** - start/callback routes, encrypted token store, identity mapping, single-flight refresh (needs #p2a) (ms #v1) #p3c
- [ ] **Phase 4 — Google Health API client** - data-type registry, list/reconcile/rollup/dailyRollup/CRUD, error normalization, Luxon time utils, mocked integration tests (needs #p3c) (ms #v1) #p4g
- [ ] ****Create a comprehensive and exhaustive README, CLAUDE.md, and AGENTS.md that covers:** #sgb

## Done
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
