# shaughv-health-mcp (Google-Health-MCP)

A remote MCP server on Vercel exposing Emmett's Google Health / Fitbit Air data to trusted
LLM clients (Claude Code/Desktop, claude.ai web+mobile, ChatGPT) — reads for
activity/sleep/heart/nutrition, writes for nutrition/hydration/measurements only.

**`docs/PLAN.md` is the source of truth** for architecture, decisions, phases, watchouts,
and the E2E verification bar. It overrides the older ChatGPT handoff spec wherever they
conflict. Read it before building anything.

## Non-negotiables (from the plan)

- Four auth layers, never conflated: Vercel login · Neon Auth (disabled) · Google Health
  consent (encrypted tokens) · MCP client auth (better-auth OAuth 2.1 + DCR, Google
  sign-in, `ALLOWED_GOOGLE_EMAILS` allowlist).
- Google OAuth tokens are AES-256-GCM encrypted at rest; never in logs/errors (use the
  redaction helper). No plaintext tokens anywhere, ever.
- No sleep/exercise/settings write tools exist — absent by design, do not scaffold them.
- No medical diagnosis language; every tool response carries freshness metadata + units.
- Node runtime only (no edge). Cross-platform npm scripts (Windows dev box).
- Data-type names: kebab in endpoints, snake in filters — go through the registry, never
  ad-hoc conversion.
- Webhooks are v1.1 (task #w11); their tables exist but stay dormant in v1.
- Library APIs move fast (better-auth `@better-auth/mcp` split July 2026; `mcp-handler`):
  consult current docs via Context7 at build time, don't code from memory.

## Commands

- `npm run dev` — local dev server (localhost:3000)
- `npm run build` / `npm start` — production build/serve
- `npm test` — Vitest suite
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` / `npm run db:migrate` — Drizzle migrations (migrations use the
  UNPOOLED Neon URL; runtime uses the pooled one)

## Task management system

This repo uses the SHAUGHV `tasks-*` system. The board source of truth is
`.tasks/TASKS.md`; milestones (dated epics) live in `.tasks/MILESTONES.md` and tasks join
one with an `(ms #id)` tag; each task's rich handoff lives at `.tasks/tasks/<id>.md` with
its `## Verification` checklist, `## Status`, and `## Activity` kept current while work is
in flight. Current milestone: **#v1** with phase tasks `#p0b`…`#p7d` (webhooks deferred as
`#w11`).

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
