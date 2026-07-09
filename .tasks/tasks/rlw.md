TT;DR: Emmett may want to move this MCP server from Vercel to Railway someday. Nothing is planned yet — this task exists so the option stays visible, the reasoning stays on the record, and agents track anything that would make the move harder.

## Why
Direct operator note (2026-07-09, during the Phase 2→3 window): "We'll leave FastMCP for now. Let's stick with the plan we had, but note that I may want to switch to Railway in the future."

Background that produced this note: Emmett asked whether the project should use **FastMCP** (the MCP framework he and Christian use at work) instead of the current stack. The answer (agreed 2026-07-09) was no — for now — because:
- **Hosting model:** FastMCP (both the Python original and the TS port) is built around a long-running process that owns its own HTTP server, sessions, and lifecycle. Vercel runs serverless functions — request-scoped, no resident process. `mcp-handler` is Vercel's purpose-built adapter that wraps the official `@modelcontextprotocol/sdk` into a Next.js route handler speaking streamable HTTP per-request.
- **Auth integration:** the OAuth 2.1 authorization server (better-auth `mcp` plugin — DCR, `/.well-known` metadata, allowlist lockdown) lives *inside the same Next.js app*, and better-auth's `withMcpAuth` wraps exactly the kind of route handler mcp-handler produces. This was already built, deployed, and verified on prod when the question came up. FastMCP would mean rebuilding a solved, verified auth story on its own hook system.
- **No capability gap:** for ~9 read tools + 5 write tools, FastMCP's advantages are ergonomic (decorators, dev CLI, session helpers), not functional. Tool definitions via `server.registerTool` + Zod are near-equivalent.

**Railway changes the calculus** because it runs long-lived containers: FastMCP becomes architecturally viable there, and some serverless constraints (no background work after response, no resident state, per-request cold starts) disappear. Hence: the FastMCP question is REOPENED if and when a Railway migration is evaluated — not before.

## What a Railway evaluation would cover (when Emmett says go)
1. **Motive check first** — what's driving the move (cost, cold starts, wanting background workers/webhook processing, wanting FastMCP parity with work projects, longer request timeouts)? The right architecture depends on which of these it is.
2. **Two migration shapes to compare:**
   - *Lift-and-shift:* run the existing Next.js app as a Railway service (Next standalone output). Cheapest path; everything portable listed below just works; keep mcp-handler.
   - *Re-platform:* split the MCP server into a FastMCP service (TS or Python) + keep/replace the auth layer. Only worth it if FastMCP-specific features or team consistency with work matter enough to rebuild auth.
3. **Cost/latency comparison** vs current Vercel free/pro usage (single-user traffic is tiny; Railway's always-on container has a floor cost, Vercel serverless is ~free at this volume — this alone may decide it).
4. **Refresh the migration inventory below** and execute the checklist.
5. **v1.1 interaction:** webhooks (#w11) are *easier* on a resident process (durable background processing, no waitUntil caveats) — if webhooks are being built around the same time, consider sequencing the migration first.

## Migration surface inventory (keep current — add a line whenever something Vercel-specific lands)
**Portable as-is:** the Next.js app itself (Railway runs Next fine via standalone build), mcp-handler (works in any Next app — not Vercel-locked), better-auth + its DB tables, Drizzle + Neon (external DB, host-agnostic), all env vars, the Google OAuth client + redirect URIs (domain-based, not host-based), tests, drizzle migrations.
**Vercel-touching today:**
- Vercel env var store (would move to Railway variables; values documented in .env.example)
- Neon is attached via Vercel Marketplace for billing/env-injection (the DB itself is plain Neon; connection strings portable; billing attachment would be unwound or kept — Neon account survives either way)
- `health.emmetts.dev` DNS CNAME points at `ccb2fac253c976e8.vercel-dns-017.com.` in Google Cloud DNS (would repoint to Railway's target)
- Deployment Protection = preview-only (Vercel-only concept; Railway equivalent: none needed, app brings its own auth)
- Vercel deploy pipeline (git push → build; Railway has its own equivalent)
- (watch) any future use of `waitUntil`, Vercel Cron, fluid compute behavior, or `@vercel/*` packages — v1.1 webhooks may add `waitUntil`; NOTE IT HERE if so

## Acceptance
Dormant until Emmett green-lights an evaluation; then: motive statement, lift-and-shift vs re-platform comparison (incl. FastMCP re-evaluation), cost/latency numbers, migration checklist from the inventory, and a go/no-go decision recorded here.

## Status
Dormant. Not part of milestone #v1. No action for agents except keeping the inventory current.

## Activity
- 2026-07-09 01:20 — created from Emmett's note; inventory seeded (agent: fable)
- 2026-07-09 01:25 — description expanded per Emmett's request: full FastMCP context, evaluation framework, migration shapes, v1.1 interaction (agent: fable)
