# AGENTS.md — shaughv-health-mcp

Operating guide for **any** coding agent (Codex, Cursor, Gemini CLI, Claude, or a human)
working in this repo. It is the tool-neutral companion to `CLAUDE.md`; both carry the same
operational rules. This file states shared facts briefly and points to `README.md` and
`docs/PLAN.md` for depth rather than duplicating them.

## Read these first (onboarding order)

1. **`docs/PLAN.md`** — the authoritative build plan and source of truth: architecture, the
   four auth layers, DB schema, MCP tool surface, phase breakdown, watchouts, and the E2E
   verification bar. It overrides the older ChatGPT handoff spec wherever they conflict.
2. **`docs/adr/0001-private-allowlist-only.md`** — the accepted audience/access decision:
   private allowlist for Emmett and Christian, no public OAuth verification or CASA. It
   overrides earlier "single-user / Emmett only" wording.
3. **`README.md`** — the human overview: what/why, setup (accounts, redirect URIs, env vars),
   the architecture diagram, and troubleshooting.
4. **`.tasks/CLAUDE.md`** — the project's working memory (who Emmett is, key terms, project
   state, preferences). "CLAUDE.md" is just the filename the tasks system uses; it is not
   tool-specific — read it regardless of which agent you are.
5. **The `.tasks/` board** — `.tasks/TASKS.md` for what's Active/next, and the relevant
   `.tasks/tasks/<id>.md` for the decisions and carry-over notes behind each task.

## What this is (brief — see README for depth)

A **private, allowlist-only remote MCP server** on Vercel (`health.emmetts.dev`) for Emmett
and Christian. Each approved person exposes only their own Google Health data to trusted LLM
clients — reads for
activity/sleep/heart/nutrition, writes for nutrition/hydration/measurements only. A thin,
typed, authenticated data adapter: the LLM reasons; the server returns accurate data with
freshness metadata. No medical claims. Stack: Next.js 16 (App Router, Node runtime),
TypeScript 5.9, `mcp-handler` + the official MCP SDK, better-auth (built-in `mcp` plugin,
OAuth 2.1 + Dynamic Client Registration), Drizzle ORM on Neon Postgres, Luxon, Zod, Vitest.

Current milestone: **`#v1`**. Phase status is on the board — read it there; don't trust any
prose snapshot that may have gone stale.

## Non-negotiables

- **Four auth layers, never conflated:** (1) Vercel login · (2) Neon Auth — **disabled** ·
  (3) Google Health consent (AES-256-GCM-encrypted tokens, under `/api/auth/google-health/*`)
  · (4) MCP client auth (better-auth OAuth 2.1 + DCR, Google sign-in restricted to
  `ALLOWED_GOOGLE_EMAILS`, under `/api/auth/mcp/*` + `/.well-known/*`). Layers 3 and 4 share
  one Google client ID but use separate flows/scopes. See `README.md` for the full table.
- **Tokens are AES-256-GCM encrypted at rest; never in logs or errors.** Run every error path
  through the `redact()` helper. No plaintext tokens anywhere, ever.
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
- **Webhooks are v1.1** (`#w11`); their tables exist but stay dormant in v1.
- **Cross-platform scripts only** — the dev box is Windows 11 / PowerShell.
- **Verify library APIs against current docs at build time** (better-auth and the MCP tooling
  move fast); don't code auth/MCP wiring from memory.

## Recorded decisions (do not silently reverse)

- **Audience stays private and allowlist-only: Emmett and Christian.** No public signup,
  unverified first-100-user rollout, Google restricted-scope verification, or CASA. DCR stays
  open only for connector compatibility; authorization still requires an allowlisted login.
  Any additional person or public-access proposal requires an amended/superseding ADR. Full
  reasoning and current implementation: `docs/adr/0001-private-allowlist-only.md`.
- **MCP stack = `mcp-handler` + official MCP SDK on Vercel serverless — deliberately NOT
  FastMCP.** FastMCP wants a long-running process with its own server/sessions/auth; this app
  is request-scoped and its OAuth story (better-auth) already lives in the same Next.js app.
  Full reasoning: `.tasks/tasks/rlw.md`.
- **A Railway migration is a *maybe*, not a plan** (`#rlw`) — it would reopen the FastMCP
  question, but only on Emmett's say-so. Don't build gratuitously Vercel-locked; if you must,
  record it in `rlw.md`'s migration-surface inventory.
- **Auth currently stays on better-auth 1.6.23's deprecated built-in `mcp` plugin** so existing
  connector registrations/tokens survive. Release 0.1.2 adds a time-boxed compatibility boundary:
  required S256 PKCE, exact supplied-resource validation, persisted encrypted RS256 keys through
  Better Auth's `jwt()` plugin, and repaired JWKS/UserInfo/ID-token responses. Do not remove that
  bridge or swap providers piecemeal. The maintained `@better-auth/oauth-provider` migration is
  tracked as `#oap` and requires a coordinated connector re-auth. The token endpoint must keep
  accepting **form-encoded POST** (a claude.ai connector quirk).
- **TypeScript is pinned to `^5`** — Next 16's build-time type checker cannot load the TS 7
  native compiler; an unpinned install broke the build.
- **REST API surface (`#api`) is a future idea**, feasible and additive. Its one present-day
  obligation: keep MCP tool handlers **thin** — orchestration belongs in `src/health-services/`
  so a future bearer-token/PAT REST surface can reuse it. See `.tasks/tasks/api.md`.

## Watchouts

- **Allowlist removal is not complete token revocation.** It blocks new users/sessions, but
  already-issued MCP access/refresh tokens are checked by token lookup and expiry. Immediate
  offboarding also requires revoking better-auth sessions/MCP tokens and the user's Google
  Health connection; see ADR-0001.
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
