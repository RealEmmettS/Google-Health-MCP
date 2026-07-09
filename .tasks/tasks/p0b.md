TT;DR: Stand up the repo skeleton — task board, Next.js app, all dependencies, env files, README, and the committed plan — so every later phase starts from a working baseline.

## Why
Direct operator order (approved plan, `docs/PLAN.md` Phase 0). Repo was empty except README.

## Plan
1. `.tasks/` board (tracked mode, shared hooks in `.claude/settings.json`), repo `CLAUDE.md` task section.
2. Copy approved plan → `docs/PLAN.md` (source of truth; overrides handoff spec).
3. Hand-rolled Next.js scaffold (App Router, TS, Node runtime — deliberately NOT create-next-app, to avoid dir-conflict dance and keep the scaffold minimal/server-centric): `package.json` (name `shaughv-health-mcp`), `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `.gitignore`, `next-env.d.ts` via first build.
4. Deps: `next react react-dom mcp-handler @modelcontextprotocol/sdk zod better-auth @better-auth/mcp drizzle-orm @neondatabase/serverless luxon` · dev: `typescript @types/node @types/react @types/react-dom @types/luxon drizzle-kit vitest msw dotenv`.
5. `.env.example` (all vars documented) + `.env.development.local` (real Neon URLs; gitignored).
6. README skeleton per handoff §27.
7. Commit + push.

## Impact
Intended: buildable baseline. Unintended risk: none — greenfield. Watch: cross-platform scripts only (Windows box); `.env.development.local` must stay gitignored.

## Acceptance
Fresh clone + `npm install` + `npm run dev` serves a page; board live; plan committed.

## Verification
- [ ] `npm install` completes clean
- [ ] `npm run dev` responds 200 on localhost:3000
- [ ] `npx tsc --noEmit` passes
- [ ] `git status` clean after commit; `.env.development.local` NOT tracked
- [ ] Board reachable (`.tasks/.board-server.json` has live port)
- [ ] `docs/PLAN.md` present in repo

## Status
Board scaffolded (TASKS/MILESTONES/config/memory/detail files). Next: board install+ensure, hooks, repo CLAUDE.md, docs/PLAN.md, app scaffold, deps, env files, README, commit.

## Activity
- 2026-07-09 00:15 — created from approved plan; moved straight to Active (agent: fable)
