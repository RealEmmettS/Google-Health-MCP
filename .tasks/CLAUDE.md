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
| MCP SDK v2 | Official split `@modelcontextprotocol/server`/`client` 2.0.0; request-scoped 2026 transport with stateless 2025 fallback |
| Better Auth OAuth Provider | Stable 1.6.25 authorization server: `/api/auth/oauth2/*`, public DCR, S256 PKCE, consent, exact-audience RS256 JWTs, hashed rotating refresh tokens. Legacy 0.1.x OAuth tables are rollback-only during `#q2` |
| DPoP | Per-Google-Health-connection P-256 key that sender-constrains the Google refresh token; private JWK is purpose-separated AES-256-GCM ciphertext |
| DCR | Dynamic Client Registration (RFC 7591) — required by claude.ai + ChatGPT connectors |
| freshness ledger | `data_freshness` table: latest webhook notification per (user, data type). Dormant until v1.1 — webhooks carry pointers, not values |
| four auth layers | 1 Vercel login · 2 Neon Auth (disabled) · 3 Google Health consent (encrypted token + DPoP key) · 4 MCP client auth (Better Auth OAuth Provider/JWT). Never conflate |

## Projects

| Project | Status | Notes |
|---|---|---|
| shaughv-health-mcp (this repo) | 1.1.1 signed-continuation auth repair; qualification active | Source of truth: `docs/PLAN.md`; audience = ADR-0002; hosting/runtime = ADR-0003; remaining qualification/soak = `#mcp2`/`#q2`. The 1.1.0 diagnostics release, 1.0.1 auth patch, and 0.3.0 cutover receipts remain historical; the webhook physical gate remains separate under `#w11` |
| shaughv-health-db | Connected | Provisioned and connected from the Vercel dashboard through its Storage/Marketplace integration, ID `divine-cloud-92550441`; Vercel injects the pooled runtime and unpooled migration URLs (Preview+Production, 2026-07-09). Neon Auth is disabled |
| Vercel project | Live | `google-health-mcp` (prj_hZe49opI8FWMx8fWnGDbNI34zUzo, team realemmetts). Domains: **health.emmetts.dev** (canonical) + google-health-mcp-realemmetts.vercel.app. Deployment Protection = preview-only (prod must stay open; app brings its own auth) |

## Preferences

- Plan (`docs/PLAN.md`) overrides the ChatGPT handoff spec where they conflict.
- Subagents: Opus 4.8 `xhigh` (or `max`) / Sonnet 5 `max` (or `xhigh`) — never lower, never Haiku, never auto-map Fable.
- Never send anything outward (email/posts/etc.) without fresh per-message approval.
- Repo-specific change boundary (2026-07-29): merge/push/deploy to `main` is pre-authorized
  because Vercel rollback is available. Before any action that invalidates or destroys the
  previous working state—credential/key rotation, revocation, destructive table/data cleanup,
  or a consent flow that may replace the working refresh token—pause and obtain fresh approval.
- Cross-platform npm scripts only (Windows dev box).
- No medical diagnosis language in tool outputs; always include freshness metadata.
- Access is private and fixed to Emmett alone through `eshaughv@gmail.com` and its native
  alias `google@emmetts.dev`. Do not add another person, open signup, or pursue Google
  verification/CASA without a superseding ADR-0002.
- `ALLOWED_GOOGLE_EMAILS` is rechecked locally on every MCP bearer request. Account removal
  is immediate; client-specific revocation can lag at most the one-hour JWT lifetime.
- Vercel env quirk: this project's env vars are SENSITIVE (write-only — `vercel env pull` returns them EMPTY; default came from the Neon connect dialog). Canonical secret copies live in `.env.development.local` + `.tasks/secure/` (both gitignored); never expect to read a secret back from Vercel.
- TOKEN_ENCRYPTION_KEY is deliberately SHARED between local and prod (one shared Neon DB = one key — split keys poison each other's token rows). Rotated 2026-07-09; ROTATING IT ORPHANS ALL STORED GOOGLE TOKENS → every user must reconnect.
- BETTER_AUTH_SECRET is SPLIT (local ≠ prod) and that's correct. It signs cookies and encrypts each environment's persisted RS256 private key in separate Development/Preview/Production JWKS tables. MCP access JWTs are verified locally; they are never inserted into the legacy token table.
- Stable-provider client/consent/code/refresh/rate-limit rows are shared across the trusted environments in the Vercel-linked Neon DB; JWKS remain environment-specific. Preview is Vercel-protected. Track environment-isolated OAuth storage if previews become public or stop being equally trusted.
- Raw 0.2.1 is a valid rollback only before Google DPoP reconsent. After a bound refresh token commits, retain `google_health_dpop_key` and roll back only to a separately qualified DPoP-capable artifact or forward-fix. Reconsent requires fresh approval.
- Current MCP host decision (2026-07-29): official SDK v2 on Vercel Node 24 + Fluid in `iad1`, deliberately not Edge/Railway/FastMCP. See ADR-0003 and closed task `#rlw`; reopen only on its measured triggers.
