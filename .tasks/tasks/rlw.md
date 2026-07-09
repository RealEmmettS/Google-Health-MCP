TT;DR: Emmett may want to move this MCP server from Vercel to Railway someday. Nothing is planned yet — this task exists so the option stays visible and so agents track anything that would make the move harder.

## Why
Direct operator note (2026-07-09): "note that I may want to switch to Railway in the future." Railway = long-running processes, which would reopen the FastMCP-vs-mcp-handler stack question (FastMCP was deliberately rejected for serverless — see .tasks/CLAUDE.md).

## Migration surface inventory (keep current — add a line whenever something Vercel-specific lands)
Portable as-is: the Next.js app itself (Railway runs Next fine), mcp-handler (works in any Next app, not Vercel-locked), better-auth, Drizzle + Neon (external DB, host-agnostic), all env vars.
Vercel-touching today:
- Vercel env var store (would move to Railway variables)
- Neon-via-Vercel-Marketplace billing/attachment (DB itself is plain Neon; connection strings portable)
- health.emmetts.dev DNS CNAME points at vercel-dns (would repoint)
- Deployment Protection setting (Vercel-only concept)
- (watch) any future use of `waitUntil`, Vercel cron, or fluid-compute-specific behavior — v1.1 webhooks may add `waitUntil`; note it here if so

## Acceptance
N/A until Emmett green-lights an evaluation; then: cost/latency comparison, migration checklist from the inventory above, FastMCP re-evaluation.

## Status
Dormant. Not part of milestone #v1.

## Activity
- 2026-07-09 01:20 — created from Emmett's note; inventory seeded (agent: fable)
