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
| Emmett | Operator/owner + approved user | `eshaughv@gmail.com` and its native alias `google@emmetts.dev` are approved in `ALLOWED_GOOGLE_EMAILS` |
| Christian Adleta | Approved user | `[redacted]` is approved in `ALLOWED_GOOGLE_EMAILS`; he connects only his own Google Health data |

## Terms

| Term | Meaning |
|---|---|
| Google Health API | Successor to Fitbit Web API; REST at `health.googleapis.com/v4`; Google OAuth + `googlehealth.*` scopes |
| Fitbit Air | Emmett's wearable; syncs to Fitbit app → Google Health cloud. Data is never live — only synced |
| MCP | Model Context Protocol; this repo IS a remote MCP server on Vercel |
| mcp-handler | Vercel's MCP adapter for Next.js (`createMcpHandler`, `withMcpAuth`) |
| better-auth mcp plugin | Makes this app an OAuth 2.1 authorization server with DCR so claude.ai/ChatGPT/Claude Code can connect; login = Google Sign-In, allowlisted. NO consent page exists or is needed (plugin auto-issues codes post-login — source-verified). MCP refresh tokens roll with a 60-day idle window ("connect once") |
| DCR | Dynamic Client Registration (RFC 7591) — required by claude.ai + ChatGPT connectors |
| freshness ledger | `data_freshness` table: latest webhook notification per (user, data type). Dormant until v1.1 — webhooks carry pointers, not values |
| four auth layers | 1 Vercel login · 2 Neon Auth (disabled) · 3 Google Health consent (encrypted tokens) · 4 MCP client auth (better-auth). Never conflate |

## Projects

| Project | Status | Notes |
|---|---|---|
| shaughv-health-mcp (this repo) | v1 live | Source of truth: `docs/PLAN.md`; accepted audience decision: `docs/adr/0001-private-allowlist-only.md`. Webhooks = v1.1 (#w11) |
| shaughv-health-db | Connected | Provisioned and connected from the Vercel dashboard through its Storage/Marketplace integration, ID `divine-cloud-92550441`; Vercel injects the pooled runtime and unpooled migration URLs (Preview+Production, 2026-07-09). Neon Auth is disabled |
| Vercel project | Live | `google-health-mcp` (prj_hZe49opI8FWMx8fWnGDbNI34zUzo, team realemmetts). Domains: **health.emmetts.dev** (canonical) + google-health-mcp-realemmetts.vercel.app. Deployment Protection = preview-only (prod must stay open; app brings its own auth) |

## Preferences

- Plan (`docs/PLAN.md`) overrides the ChatGPT handoff spec where they conflict.
- Subagents: Opus 4.8 `xhigh` (or `max`) / Sonnet 5 `max` (or `xhigh`) — never lower, never Haiku, never auto-map Fable.
- Never send anything outward (email/posts/etc.) without fresh per-message approval.
- Cross-platform npm scripts only (Windows dev box).
- No medical diagnosis language in tool outputs; always include freshness metadata.
- Access is private and fixed to Emmett and Christian. Do not add another identity, open
  signup, or pursue Google verification/CASA without an amended or superseding ADR-0001.
- Removing an identity from `ALLOWED_GOOGLE_EMAILS` blocks new sign-ins but does not revoke
  existing MCP tokens by itself; immediate offboarding also requires session/MCP-token and
  Google Health connection revocation.
- Vercel env quirk: this project's env vars are SENSITIVE (write-only — `vercel env pull` returns them EMPTY; default came from the Neon connect dialog). Canonical secret copies live in `.env.development.local` + `.tasks/secure/` (both gitignored); never expect to read a secret back from Vercel.
- TOKEN_ENCRYPTION_KEY is deliberately SHARED between local and prod (one shared Neon DB = one key — split keys poison each other's token rows). Rotated 2026-07-09; ROTATING IT ORPHANS ALL STORED GOOGLE TOKENS → every user must reconnect.
- BETTER_AUTH_SECRET is SPLIT (local ≠ prod) and that's FINE — do NOT "fix"/align it. It gates only session-cookie signing (each env validates its own login cookies); MCP access tokens are validated by a plain DB lookup on oauth_access_token.accessToken (plaintext + expiry check, source-verified) so tokens stay portable across envs. Aligning it is needless risk; splitting it is mildly good security (can't forge a prod session from the local secret). Consequence: the FULL real OAuth chain in scripts/live-verify-e2e.ts (forged session cookie) only works against localhost (matching secret); against prod the script proves the deployed withMcpAuth seam via its direct-token-insert fallback.
- MCP stack decision (2026-07-09, Emmett + fable): mcp-handler + official MCP SDK on Vercel serverless — deliberately NOT FastMCP (FastMCP wants a long-running process and its own auth; ours is serverless + better-auth-integrated). Emmett may want to migrate to RAILWAY in the future (see Backlog #rlw) — that's the moment the FastMCP question reopens. Until then, build nothing Vercel-locked without noting it in #rlw's detail file.
