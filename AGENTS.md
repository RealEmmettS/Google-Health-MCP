# AGENTS.md — shaughv-health-mcp

Operating guide for **any** coding agent (Codex, Cursor, Gemini CLI, Claude, or a human)
working in this repo. It is the tool-neutral companion to `CLAUDE.md`; both carry the same
operational rules. This file states shared facts briefly and points to `README.md` and
`docs/PLAN.md` for depth rather than duplicating them.

## Read these first (onboarding order)

1. **`docs/PLAN.md`** — the authoritative build plan and source of truth: architecture, the
   four auth layers, DB schema, MCP tool surface, phase breakdown, watchouts, and the E2E
   verification bar. It overrides the older ChatGPT handoff spec wherever they conflict.
2. **`docs/adr/0002-single-user-private.md`** — the current audience/access decision:
   private and Emmett-only, no public OAuth verification or CASA. ADR-0001 remains the
   historical private/unverified rationale.
3. **`README.md`** — the human overview: what/why, setup (accounts, redirect URIs, env vars),
   the architecture diagram, and troubleshooting.
4. **`.tasks/CLAUDE.md`** — the project's working memory (who Emmett is, key terms, project
   state, preferences). "CLAUDE.md" is just the filename the tasks system uses; it is not
   tool-specific — read it regardless of which agent you are.
5. **The `.tasks/` board** — `.tasks/TASKS.md` for what's Active/next, and the relevant
   `.tasks/tasks/<id>.md` for the decisions and carry-over notes behind each task.

## What this is (brief — see README for depth)

A **private, allowlist-only remote MCP server** on Vercel (`health.emmetts.dev`) for Emmett
alone (two approved aliases). It exposes his Google Health data to trusted LLM clients — reads for
activity/sleep/heart/nutrition, writes for nutrition/hydration/measurements only. A thin,
typed, authenticated data adapter: the LLM reasons; the server returns accurate data with
freshness metadata. No medical claims. Stack: Next.js 16 (App Router, Node runtime),
  TypeScript 5.9, official `@modelcontextprotocol/server` v2, stable Better Auth OAuth Provider
  (OAuth 2.1, DCR, S256 PKCE, exact-audience JWTs), Drizzle ORM on Neon Postgres, Luxon, Zod, Vitest.

Current milestone: **`#mcp2`**, the Google Health MCP stable line (currently 1.1.1) and remaining
qualification. Phase status is on the board — read it there; don't trust any prose snapshot
that may have gone stale.

## Non-negotiables

- **Four auth layers, never conflated:** (1) Vercel login · (2) Neon Auth — **disabled** ·
  (3) Google Health consent (AES-256-GCM-encrypted tokens and DPoP private key, under `/api/auth/google-health/*`)
  · (4) MCP client auth (better-auth OAuth 2.1 + DCR, Google sign-in restricted to
  `ALLOWED_GOOGLE_EMAILS`, under `/api/auth/oauth2/*` + `/.well-known/*`). Layers 3 and 4 share
  one Google client ID but use separate flows/scopes. See `README.md` for the full table.
- **Credential storage models stay distinct.** Google Health tokens and DPoP private keys are
  AES-256-GCM encrypted; MCP refresh tokens/client secrets are hashed; MCP access JWT values are
  never stored. Run every error path through `redact()`. No plaintext secret in logs or errors.
- **No sleep / exercise / settings write tools exist** — absent by design; do not scaffold
  them even though those data types support writes at the API level.
- **No medical diagnosis language.** Every tool response carries freshness metadata
  (`retrievedAt`, `latestDataTime?`, `isPossiblyStale`, `note`) + units. Missing data ≠ zero
  activity; "nothing logged" ≠ "you didn't do it."
- **Node runtime only** (no edge — needs `node:crypto` + the Postgres driver). Each API route
  sets `export const runtime = "nodejs"`.
- **Data-type names go through the registry** (`src/google-health/registry.ts`): kebab in
  endpoint paths (`body-fat`), snake in filter prefixes (`body_fat`). Never do ad-hoc string
  conversion.
- **Writes are Zod-validated, explicit-input-only, and audit-logged** to `mutation_audit_log`.
  Never infer a value; never invent a step goal.
- **Webhooks are v1.1** (`#w11`); the endpoint stores pointer-only events and must verify
  Google's Tink-prefixed P-256 signature before durable processing.
- **Cross-platform scripts only** — the dev box is Windows 11 / PowerShell.
- **Verify library APIs against current docs at build time** (better-auth and the MCP tooling
  move fast); don't code auth/MCP wiring from memory.

## Recorded decisions (do not silently reverse)

- **Audience stays private and allowlist-only: Emmett alone.** No public signup,
  unverified first-100-user rollout, Google restricted-scope verification, or CASA. DCR stays
  open only for connector compatibility; authorization still requires an allowlisted login.
  Any additional person or public-access proposal requires an amended/superseding ADR. Full
  reasoning and current implementation: `docs/adr/0002-single-user-private.md`.
- **MCP stack = official SDK v2 on Vercel Node 24 Functions with Fluid Compute in `iad1` —
  deliberately NOT Edge, Railway, or FastMCP.** The transport is request-scoped and serves
  modern 2026 plus stateless legacy 2025 traffic from one factory. Full reasoning:
  `docs/adr/0003-vercel-node-fluid-mcp-2026.md` and `.tasks/tasks/rlw.md`.
- **1.0.0 MCP auth (introduced in 0.3.0) = exact stable `better-auth@1.6.25` +
  `@better-auth/oauth-provider@1.6.25`.** Endpoints live under `/api/auth/oauth2/*`; token
  grants stay form-encoded. Public DCR is S256-only, access JWTs have the one exact `/api/mcp`
  audience and are locally verified, refresh tokens are hashed/rotating, and CIMD waits for a
  maintained stable release. The known 1.6.x resource-indicator advisory is contained by one
  configured audience plus exact authorize/token/refresh/resource-server checks. Legacy
  0.1.x client/token/consent tables are rollback-only for seven days—do not query, translate,
  export, or delete them before `#q2` accepts cleanup.
- **TypeScript is pinned to `^5`** — Next 16's build-time type checker cannot load the TS 7
  native compiler; an unpinned install broke the build.
- **REST API surface (`#api`) is a future idea**, feasible and additive. Its one present-day
  obligation: keep MCP tool handlers **thin** — orchestration belongs in `src/health-services/`
  so a future bearer-token/PAT REST surface can reuse it. See `.tasks/tasks/api.md`.

## Watchouts

- **Allowlist removal is rechecked locally on every MCP bearer request.** Account removal is
  immediate; client-specific revocation can leave an issued JWT valid for at most one hour,
  while emergency signing-key rotation invalidates all access JWTs. See ADR-0002.
- **Kebab vs snake** data-type names — registry only.
- **Civil vs physical time:** `rollUp` takes a physical-time range; `dailyRollUp` takes a
  civil range with **non-zero-padded** month/day integers (leading zeros are rejected). Sleep
  crosses midnight — query by `civil_end_time >= <date>`. `daily-*` data types carry NO
  physical timestamp — filter them on the civil `date` field (`<snake>.date >= "YYYY-MM-DD"`);
  a sample-time filter silently returns everything (live-verified 2026-07-09). Default
  timezone `America/Chicago`; be DST-safe.
- **True zeros:** some data types have real zeros (steps, distance, floors, altitude,
  total-calories); most gaps are missing data. Never phrase a gap as inactivity.
- **Refresh tokens** arrive only with `access_type=offline` (+ usually `prompt=consent`);
  don't assume one on every exchange — keep the old one unless replaced. 7-day expiry until
  the OAuth app is published to production.
- **Serverless lifecycle:** nothing survives the response — no background work after
  returning; durable writes must complete first.
- **Neon:** pooled URL at runtime, unpooled URL for migrations.
- **Payloads:** cap and summarize; never dump raw high-frequency series.
- **`update_profile`:** confirm a writable profile endpoint exists in the live v4 REST
  reference before implementing; otherwise drop it. Do not invent fields.
- **Never log tokens or `Authorization` headers; redact all error paths.**

## Commands

- `npm run dev` — local dev server (`localhost:3000`)
- `npm run build` / `npm start` — production build / serve
- `npm test` — Vitest · `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` / `npm run db:migrate` — Drizzle migrations (migrations use the
  **unpooled** Neon URL; runtime uses the **pooled** one)
- `node scripts/db-inspect.mjs` — list/inspect Neon tables

## Secrets

Never put secret **values** (connection strings, client secrets, keys, tokens) in code, logs,
committed files, the task board, or any markdown. Reference env-var **names** only; every
variable is documented in `.env.example`. Local values live in `.env.development.local`
(gitignored); production values live in the host's env store; anything private the board
needs goes in `.tasks/secure/` (gitignored).

## Using the task board

The board is a self-contained folder at `.tasks/` — plain Markdown plus a small local
dashboard server. No external service.

- **`.tasks/TASKS.md`** — the board, in four sections: **Backlog**, **To-Do**, **Active**,
  **Done**. Each task is a checkbox line ending in a short `#id`, e.g.
  `- [ ] **Title** - one-line description (ms #v1) #p5m`. Tags in the line:
  - `(ms #id)` — the milestone this task belongs to (milestones live in
    `.tasks/MILESTONES.md`).
  - `(needs #id)` — a dependency on another task.
  - `(owner name)` — who owns it (`emmett`, an agent, or both). Respect it.
  - `(done YYYY-MM-DD)` — completion date, added when a task moves to **Done**.
- **Subtasks** — small required steps are indented checkbox rows under the parent, optionally
  followed by indented `    > detail` lines. Put board-trackable steps here, not buried in
  prose. If a piece of work needs its own status/owner, make it a separate top-level task and
  link it with `(needs #id)`.
- **`.tasks/tasks/<id>.md`** — one rich detail file per task: a TT;DR line up top, then
  `## Why`, `## Plan`, `## Verification` (a checklist), `## Status`, and `## Activity` (a dated
  log). Keep an Active task's `## Status` and `## Activity` current so the next agent can
  resume mid-task. Attribute every `## Activity` line, e.g. `(agent: <name>)` or `(emmett)`.
- **Completion gates** (enforced): a task cannot be marked done while any subtask is unchecked
  or any `## Verification` item is still `[ ]` — either verify it, or waive it with a recorded
  reason: `(waived YYYY-MM-DD — agent: <why>)`. A milestone cannot close while it has open
  child tasks.
- **Id rules:** ids are short and unique (a few characters). Don't reuse an id; don't renumber
  existing ones. New tasks get a fresh id.
- **This is a git-tracked, shared board:** pull before a board session, and commit after
  meaningful task changes so status stays visible to the operator and other agents.

The live dashboard is optional and per-repo — a port is **not** an identity. Resolve the
current port from `.tasks/.board-server.json`, or run `node .tasks/board-server.mjs status`
(prints running state as JSON) and verify the reported repo root before trusting a board URL;
multiple boards can run on this machine at once.

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

## Where things live

See `README.md` §"Repository structure" for the full tree. Quick map: `app/` = Next.js routes
and pages (auth, well-known metadata, healthcheck, the live MCP endpoint, and the local SVG
favicon); `src/` = auth, db, security, audit, the typed Google Health client/registry,
timezone helpers, shared health services, and thin MCP registration; `drizzle/` = migrations;
`tests/unit/` = Vitest.
