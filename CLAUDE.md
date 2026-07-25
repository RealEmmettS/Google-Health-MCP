# CLAUDE.md — shaughv-health-mcp

Agent instructions for Claude coding sessions in this repo. For the human-facing overview
(what/why, setup, architecture diagram, troubleshooting) read **`README.md`**. For the
agent-agnostic version of this file, see **`AGENTS.md`** — the two stay in sync.

## What this is

A **private, allowlist-only remote MCP server** on Vercel (`health.emmetts.dev`) for Emmett
alone (two approved aliases). It exposes his Google Health data to trusted LLM
clients (Claude Code / Desktop,
claude.ai web + mobile connectors, ChatGPT connectors): **reads** for
activity/sleep/heart/nutrition, **writes** for nutrition/hydration/measurements only. It is a
thin, typed, authenticated data adapter — the LLM reasons; the server returns accurate data
with freshness metadata. No medical claims.

## Source of truth and current phase

- **`docs/PLAN.md` is the source of truth** for architecture, the four auth layers, the DB
  schema, the tool surface, the phase breakdown, the watchouts, and the E2E verification bar.
  It overrides the older ChatGPT handoff spec wherever they conflict. **Read it before
  building anything.**
- **The `.tasks/` board is the live status.** `docs/PLAN.md` defines the plan; the board
  tracks execution. Before starting work, read `.tasks/TASKS.md` (what's Active / next) and
  the relevant `.tasks/tasks/<id>.md` detail file — the decisions and carry-over notes live
  there. Current milestone: **`#v1`**. Do not restate volatile phase status in docs that go
  stale; point at the board.
- **Accepted ADRs govern their specific scope.** Read
  `docs/adr/0002-single-user-private.md` before changing authentication, the approved
  audience, Google OAuth publication/verification, or offboarding behavior.

## Non-negotiables (from the plan)

- **Four auth layers, never conflated:** (1) Vercel login · (2) Neon Auth — **disabled** ·
  (3) Google Health consent (AES-256-GCM-encrypted tokens) · (4) MCP client auth (better-auth
  OAuth 2.1 + DCR, Google sign-in, `ALLOWED_GOOGLE_EMAILS` allowlist). Layers 3 and 4 share
  one Google client ID but use separate flows/scopes.
- **Tokens are AES-256-GCM encrypted at rest; never in logs or errors.** Use the `redact()`
  helper on every error path. No plaintext tokens anywhere, ever.
- **No sleep / exercise / settings write tools exist** — absent by design. Do not scaffold
  them, even though the registry knows those data types support writes at the API level.
- **No medical diagnosis language.** Every tool response carries **freshness metadata**
  (`retrievedAt`, `latestDataTime?`, `isPossiblyStale`, `note`) + units. Missing data ≠ zero
  activity; "nothing logged" ≠ "you didn't eat."
- **Node runtime only** (no edge — `node:crypto` + the Postgres driver). Every API route sets
  `export const runtime = "nodejs"`.
- **Data-type names go through the registry** (`src/google-health/registry.ts`): kebab in
  endpoint paths (`body-fat`), snake in filter prefixes (`body_fat`). Never do ad-hoc
  `.replace("-", "_")` conversion.
- **Writes are Zod-validated, explicit-input-only, and audit-logged** to
  `mutation_audit_log`. Never infer a value; never invent a step goal.
- **Webhooks are v1.1** (`#w11`). The endpoint stores pointer-only events and must verify
  Google's Tink-prefixed P-256 signature before durable processing.
- **Cross-platform npm scripts only** — the dev box is Windows 11 / PowerShell.
- **Library APIs move fast** — consult current docs (Context7) at build time; don't code
  auth/MCP wiring from memory (see decisions below).

## Recorded decisions (do not silently reverse)

- **Audience stays private and allowlist-only: Emmett alone.** No public signup,
  unverified first-100-user rollout, Google restricted-scope verification, or CASA. DCR stays
  open only for connector compatibility; authorization still requires an allowlisted login.
  Any additional person or public-access proposal requires an amended/superseding ADR. Full
  reasoning and current implementation: `docs/adr/0002-single-user-private.md`.
- **MCP stack = `mcp-handler` + official MCP SDK on Vercel serverless — deliberately NOT
  FastMCP.** FastMCP wants a long-running process with its own HTTP server, sessions, and auth;
  Vercel is request-scoped and our OAuth story (better-auth) already lives in the same Next.js
  app and is verified on prod. FastMCP would mean rebuilding a solved auth layer. Full
  reasoning in `.tasks/tasks/rlw.md`.
- **Railway migration is a *maybe*, not a plan** (`#rlw`). It runs long-lived containers, so it
  reopens the FastMCP question — but only if/when Emmett green-lights an evaluation. Until then,
  don't build anything gratuitously Vercel-locked; if you must, add a line to `rlw.md`'s
  migration-surface inventory.
- **Auth currently stays on better-auth 1.6.23's deprecated built-in `mcp` plugin**
  (`better-auth/plugins`) so existing connector registrations/tokens survive. Release 0.1.2 adds
  a time-boxed compatibility boundary: required S256 PKCE, exact supplied-resource validation,
  persisted encrypted RS256 keys through Better Auth's `jwt()` plugin, and repaired
  JWKS/UserInfo/ID-token responses. Do not remove that bridge or swap providers piecemeal. The
  maintained `@better-auth/oauth-provider` migration is tracked as `#oap` and requires a
  coordinated connector re-auth. Auth endpoints live under `/api/auth/mcp/*`; the token endpoint
  must keep accepting **form-encoded POST** (a claude.ai connector quirk).
- **TypeScript is pinned to `^5`** (5.9.x). Next 16's build-time type checker cannot load the
  TS 7 native compiler; an unpinned install resolved TS 7 and broke the Vercel build.
- **REST API surface (`#api`) is a future idea**, feasible and additive. Its one present-day
  obligation: keep Phase 5 MCP tool handlers **thin** — orchestration belongs in
  `src/health-services/` so a future bearer-token REST surface can reuse it. See `api.md`.

## Watchouts (read before coding)

- **Allowlist removal is rechecked on every MCP bearer request.** Complete offboarding still
  deletes Better Auth sessions/MCP tokens and the user's Google Health connection; see
  ADR-0002.
- **Kebab vs snake** data-type names — registry only (above).
- **Civil vs physical time:** `rollUp` takes a physical-time range; `dailyRollUp` takes a
  civil range with **non-zero-padded** month/day integers (the API rejects leading zeros —
  "Octal/hex numbers are not valid JSON"). Sleep sessions cross midnight — query by
  `civil_end_time >= <date>`. `daily-*` types carry NO physical timestamp — filter on the
  civil `date` field (`<snake>.date >= "YYYY-MM-DD"`); a sample-time filter silently returns
  everything (live-verified 2026-07-09). Default timezone `America/Chicago`; be DST-safe (Luxon).
- **True zeros / on-wrist filtering:** some data types have real zeros (steps, distance,
  floors, altitude, total-calories); most gaps are missing data, not zero activity. Never
  phrase a gap as inactivity.
- **Refresh tokens:** only issued with `access_type=offline` (+ usually `prompt=consent`);
  don't assume one arrives on every exchange — keep the old refresh token unless replaced.
  7-day expiry until the OAuth app is published to production.
- **Serverless lifecycle:** nothing survives the response — no fire-and-forget background
  work. Durable writes must finish before returning.
- **Neon:** pooled `DATABASE_URL` at runtime, unpooled `DATABASE_URL_UNPOOLED` for migrations.
- **Payloads:** cap and summarize — an LLM must never receive 1,440 raw HR samples.
- **`update_profile`:** verify a writable profile endpoint exists in the live v4 REST
  reference before implementing; drop the tool if it doesn't. Do not invent fields.
- **Never log tokens or `Authorization` headers; redact all error paths.**

## Commands

- `npm run dev` — local dev server (`localhost:3000`)
- `npm run build` / `npm start` — production build / serve
- `npm test` — Vitest suite · `npm run test:watch` — watch mode
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` / `npm run db:migrate` — Drizzle (migrations use the **unpooled**
  Neon URL; runtime uses the **pooled** one)
- `node scripts/db-inspect.mjs` — list/inspect Neon tables

## Task management system

This repo uses the SHAUGHV `tasks-*` system. The board source of truth is
`.tasks/TASKS.md`; milestones (dated epics) live in `.tasks/MILESTONES.md` and tasks join
one with an `(ms #id)` tag; each task's rich handoff lives at `.tasks/tasks/<id>.md` with
its `## Verification` checklist, `## Status`, and `## Activity` kept current while work is
in flight. Current milestone: **#v1** with phase tasks `#p0b`…`#p7d` (webhooks deferred as
`#w11`; future ideas parked as `#api` / `#rlw`).

Use proper subtasks for small required steps that should be visible and checkable in the
dashboard modal: indented checkbox rows under the parent task in `.tasks/TASKS.md`,
optionally followed by indented description lines (`    > detail`). Don't bury
board-trackable steps as plain text in the parent description. If related work is large
enough to need its own status/owner, make it a separate top-level task linked with
`(needs #id)`.

Completion gates (board-enforced): a task can't be done while a subtask is unchecked, or
while a `## Verification` item is still `[ ]` — verify it or waive it with a recorded
reason (`(waived YYYY-MM-DD — agent: <why>)`); a milestone can't close over open child
tasks. Use `/tasks-create` for guided creation.

Never put secrets (API keys, tokens, credentials) in `TASKS.md`, detail files, `CLAUDE.md`,
or `memory/` — use env vars / the OS keychain, or `.tasks/secure/` (gitignored).

This is a **git-tracked (shared) board**: attribute `## Activity` lines (`(agent: …)` /
`(emmett)`), respect `(owner name)`, pull before board sessions, commit after meaningful
task changes. Keep Active tasks' `## Status`/`## Activity` current as you work so
`/tasks-start` can resume mid-task.

The live board's port is per-repo, never assumed: resolve it from
`.tasks/.board-server.json` (or `node .tasks/board-server.mjs status`) and verify identity
before using a board URL or API — multiple boards run on this machine (see `tasks-boards`).

Relevant skills: `tasks-start`, `tasks-create`, `tasks-management`, `tasks-update`,
`tasks-memory`, `tasks-boards`, `tasks-remove`. Optional companions if installed: `ttdr`,
`personal-productivity`, `iterative-plan`, `git-workflow`.

### Skill routing and current guidance

Use `/tasks-start` to initialize, repair, upgrade, relaunch, or resume the board.
`/tasks-create` is the preferred way to add a well-formed milestone, task, or proper
dashboard-visible subtask; `tasks-management` is the format and completion contract.
Use `/tasks-update` to upgrade and reconcile the existing board, sync/triage current
work, and refresh memory. `tasks-memory` governs that memory, `tasks-boards` governs
live-server identity, and `/tasks-remove` decommissions the system. As work changes,
keep `.tasks/TASKS.md` plus each Active task's `## Status` and `## Activity` current.

If the installed tasks plugin is missing or may be older than the board, first try the
harness-native plugin update. If that is unavailable, fails, or still leaves freshness
uncertain, use the GitHub skill/connector to read the relevant current `main` file under
`RealEmmettS/shaughv-tasks/skills/<skill-name>/SKILL.md` and use it as the latest
operating guidance: https://github.com/RealEmmettS/shaughv-tasks/tree/main/skills
