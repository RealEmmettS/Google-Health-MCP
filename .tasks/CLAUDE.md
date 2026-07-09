<!-- tasks-bootstrap: done -->
> Secrets: never stored here or in memory/. See .tasks/secure/ (gitignored), or env/keychain.

# Working Memory — shaughv-health-mcp

## Me

| Field | Value |
|---|---|
| Name | Emmett Shaughnessy ("Emmett") |
| Email | hey@emmetts.dev (dev identity) |
| Google/Fitbit account | **eshaughv@gmail.com** (native alias google@emmetts.dev) — the ALLOWED_GOOGLE_EMAILS + test-user account |
| Timezone | America/Chicago |
| Brand | SHAUGHV (personal brand; design skill available as `shaughv-code:shaughv-design`) |
| Dev box | Windows 11, Node v24, PowerShell primary |

## People

| Name | Who | Notes |
|---|---|---|
| Emmett | Operator/owner | Sole user of this MCP in v1; his Google account(s) go in `ALLOWED_GOOGLE_EMAILS` |

## Terms

| Term | Meaning |
|---|---|
| Google Health API | Successor to Fitbit Web API; REST at `health.googleapis.com/v4`; Google OAuth + `googlehealth.*` scopes |
| Fitbit Air | Emmett's wearable; syncs to Fitbit app → Google Health cloud. Data is never live — only synced |
| MCP | Model Context Protocol; this repo IS a remote MCP server on Vercel |
| mcp-handler | Vercel's MCP adapter for Next.js (`createMcpHandler`, `withMcpAuth`) |
| better-auth / @better-auth/mcp | Makes this app an OAuth 2.1 authorization server with DCR so claude.ai/ChatGPT/Claude Code can connect; login = Google Sign-In, allowlisted |
| DCR | Dynamic Client Registration (RFC 7591) — required by claude.ai + ChatGPT connectors |
| freshness ledger | `data_freshness` table: latest webhook notification per (user, data type). Dormant until v1.1 — webhooks carry pointers, not values |
| four auth layers | 1 Vercel login · 2 Neon Auth (disabled) · 3 Google Health consent (encrypted tokens) · 4 MCP client auth (better-auth). Never conflate |

## Projects

| Project | Status | Notes |
|---|---|---|
| shaughv-health-mcp (this repo) | v1 in build | Source of truth: `docs/PLAN.md`. Milestone #v1, phases #p0b→#p7d. Webhooks = v1.1 (#w11) |
| shaughv-health-db | Connected | Neon Postgres via Vercel Marketplace, ID `divine-cloud-92550441`; pooled URL at runtime, unpooled for migrations. Connected to the Vercel project (DATABASE_URL injected, Preview+Production, 2026-07-09) |
| Vercel project | Live | `google-health-mcp` (prj_hZe49opI8FWMx8fWnGDbNI34zUzo, team realemmetts). Domains: **health.emmetts.dev** (canonical) + google-health-mcp-realemmetts.vercel.app. Deployment Protection = preview-only (prod must stay open; app brings its own auth) |

## Preferences

- Plan (`docs/PLAN.md`) overrides the ChatGPT handoff spec where they conflict.
- Subagents: Opus 4.8 `xhigh` (or `max`) / Sonnet 5 `max` (or `xhigh`) — never lower, never Haiku, never auto-map Fable.
- Never send anything outward (email/posts/etc.) without fresh per-message approval.
- Cross-platform npm scripts only (Windows dev box).
- No medical diagnosis language in tool outputs; always include freshness metadata.
- MCP stack decision (2026-07-09, Emmett + fable): mcp-handler + official MCP SDK on Vercel serverless — deliberately NOT FastMCP (FastMCP wants a long-running process and its own auth; ours is serverless + better-auth-integrated). Emmett may want to migrate to RAILWAY in the future (see Backlog #rlw) — that's the moment the FastMCP question reopens. Until then, build nothing Vercel-locked without noting it in #rlw's detail file.
