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
| Christian Adleta | Formerly approved | Removed by Emmett on 2026-07-25; production inventory found no account or stored rows |

## Terms

| Term | Meaning |
|---|---|
| Google Health API | Successor to Fitbit Web API; REST at `health.googleapis.com/v4`; Google OAuth + `googlehealth.*` scopes |
| Fitbit Air | Emmett's wearable; syncs to Fitbit app → Google Health cloud. Data is never live — only synced |
| MCP | Model Context Protocol; this repo IS a remote MCP server on Vercel |
| mcp-handler | Vercel's MCP adapter for Next.js (`createMcpHandler`, `withMcpAuth`) |
| better-auth mcp plugin | Deprecated legacy authorization server retained temporarily so existing DCR/tokens survive. 0.1.2 wraps it with S256 PKCE, canonical-resource checks, encrypted persisted RS256 JWKS signing, and repaired ID-token/UserInfo responses. Successful refreshes receive a fresh 60-day token, but the prior token is not immediately revoked; full maintained-provider migration + coordinated connector re-auth is `#oap` |
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
- Access is private and fixed to Emmett alone through `eshaughv@gmail.com` and its native
  alias `google@emmetts.dev`. Do not add another person, open signup, or pursue Google
  verification/CASA without a superseding ADR-0002.
- `ALLOWED_GOOGLE_EMAILS` is rechecked on every MCP bearer request. Complete offboarding
  still deletes Better Auth sessions/MCP grants and the Google Health connection.
- Vercel env quirk: this project's env vars are SENSITIVE (write-only — `vercel env pull` returns them EMPTY; default came from the Neon connect dialog). Canonical secret copies live in `.env.development.local` + `.tasks/secure/` (both gitignored); never expect to read a secret back from Vercel.
- TOKEN_ENCRYPTION_KEY is deliberately SHARED between local and prod (one shared Neon DB = one key — split keys poison each other's token rows). Rotated 2026-07-09; ROTATING IT ORPHANS ALL STORED GOOGLE TOKENS → every user must reconnect.
- BETTER_AUTH_SECRET is SPLIT (local ≠ prod) and that's FINE — do NOT "fix"/align it. It signs each environment's login cookies and encrypts that environment's persisted MCP RS256 private key (separate Development/Preview/Production JWKS tables); legacy MCP access tokens are still validated by DB lookup. `scripts/live-verify-e2e.ts` intentionally has NO direct-token fallback: its forged-session full OAuth chain defaults to localhost and refuses non-local mutations without an explicit flag. Verify production with safe metadata/JWKS/401 probes plus a real client; do not try to align secrets or resurrect token insertion to make the headless script forge a prod login.
- MCP stack decision (2026-07-09, Emmett + fable): mcp-handler + official MCP SDK on Vercel serverless — deliberately NOT FastMCP (FastMCP wants a long-running process and its own auth; ours is serverless + better-auth-integrated). Emmett may want to migrate to RAILWAY in the future (see Backlog #rlw) — that's the moment the FastMCP question reopens. Until then, build nothing Vercel-locked without noting it in #rlw's detail file.
