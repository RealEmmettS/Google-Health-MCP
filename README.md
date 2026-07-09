# shaughv-health-mcp

A **remote MCP server** on Vercel that lets trusted LLM assistants (Claude Code/Desktop,
claude.ai web + mobile, ChatGPT) read Emmett's **Google Health / Fitbit** data and log
nutrition, hydration, and body measurements — the things a Fitbit Air can't track itself.

**What it is:** a thin, typed, authenticated data adapter over the
[Google Health API](https://developers.google.com/health) (`health.googleapis.com/v4`).
**What it is not:** a health warehouse, an analytics product, or anything that diagnoses.
The LLM does the reasoning; this server returns accurate data with timestamps, units, and
freshness metadata.

> 📋 **`docs/PLAN.md` is the build plan and source of truth** — architecture, the four
> auth layers, DB schema, tool surface, watchouts, and the E2E verification bar.
> 🗂️ Work is tracked on the `.tasks/` board (milestone `#v1`, phases `#p0b`–`#p7d`).

## Architecture (short version)

```
Fitbit Air → Fitbit app sync → Google Health cloud → Google Health API
                                        ↑ Google OAuth (encrypted tokens in Neon)
LLM client ──OAuth 2.1 + DCR──> Next.js on Vercel (mcp-handler) ──> MCP tools/resources
```

- **Next.js App Router + TypeScript**, Node runtime, hosted on Vercel
- **`mcp-handler`** — MCP endpoint at `/api/mcp` (streamable HTTP)
- **better-auth + `@better-auth/mcp`** — this app IS an OAuth 2.1 authorization server
  (dynamic client registration) whose only login is Google Sign-In, restricted to
  `ALLOWED_GOOGLE_EMAILS`
- **Neon Postgres + Drizzle** — encrypted OAuth tokens, audit log, webhook tables (v1.1)
- **Separate Google Health consent flow** (`/api/auth/google-health/start`) storing
  AES-256-GCM-encrypted tokens

## Required accounts / setup

1. **Google Cloud** — Google Health API enabled; OAuth web client with redirect URIs
   (see below); consent screen with the `googlehealth.*` scopes; app published to
   **In production** (Testing status expires refresh tokens after 7 days).
2. **Vercel** — project imported from this repo.
3. **Neon** — Postgres via Vercel Marketplace, connected to the project (injects
   `DATABASE_URL`).

### Redirect URIs (Google OAuth client)

Canonical domain: **`health.emmetts.dev`** (custom) · `google-health-mcp-realemmetts.vercel.app` (Vercel-assigned, also serves)

```
https://health.emmetts.dev/api/auth/callback/google
https://health.emmetts.dev/api/auth/google-health/callback
https://google-health-mcp-realemmetts.vercel.app/api/auth/callback/google
https://google-health-mcp-realemmetts.vercel.app/api/auth/google-health/callback
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/auth/google-health/callback
```

## Local development

```bash
npm install
cp .env.example .env.development.local   # then fill in values
npm run dev                              # http://localhost:3000
npm test                                 # Vitest
npm run typecheck
npm run db:generate && npm run db:migrate  # Drizzle (uses DATABASE_URL_UNPOOLED)
```

## Environment variables

See `.env.example` — every variable is documented there. Rules: no secrets in code or
logs; Google tokens are always encrypted at rest; local and prod use different
`TOKEN_ENCRYPTION_KEY` values (losing the key means reconnecting Google Health).

## Connecting an MCP client (once deployed)

- **Claude Code:** `claude mcp add --transport http health https://health.emmetts.dev/api/mcp`
- **claude.ai:** Settings → Connectors → Add custom connector → `https://health.emmetts.dev/api/mcp`
- **ChatGPT:** Add custom connector (registers via dynamic client registration)

Each client walks the OAuth flow; sign in with the allowlisted Google account.

## Status

- ✅ Phase 0 — repo bootstrap (this commit)
- ⬜ Phases 1–7 — see `docs/PLAN.md` and the `.tasks/` board
- ⬜ v1.1 — Google Health webhooks (deferred by design)

## Security notes

- Four auth layers, never conflated (plan §"Four auth layers")
- MCP endpoint requires OAuth; sign-in allowlisted; tokens AES-256-GCM at rest
- Mutations (nutrition/hydration/measurements only) are Zod-validated and audit-logged
- No sleep/exercise/settings writes exist at all
