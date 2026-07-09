TT;DR: Make this app an OAuth 2.1 authorization server (better-auth + @better-auth/mcp, DCR on) whose only login is Google Sign-In restricted to Emmett's allowlisted email(s) — so claude.ai, ChatGPT, and Claude Code can all connect.

## Why
Decision #1/#2 in `docs/PLAN.md`: claude.ai + ChatGPT connectors support OAuth (with DCR), not static bearer headers. Emmett chose Google-federated full OAuth over WorkOS/Clerk/bearer options.

## Plan
- `src/auth/auth.ts`: better-auth instance — Drizzle adapter (Neon), Google social provider (scopes: openid email profile ONLY — health scopes are a separate flow), `@better-auth/mcp` plugin with `allowDynamicClientRegistration: true`.
- Allowlist: reject sign-in when email ∉ `ALLOWED_GOOGLE_EMAILS` (comma-separated env) — enforce server-side in better-auth hook/callback, not UI.
- Routes: `app/api/auth/[...all]/route.ts` (better-auth handler), `.well-known/oauth-authorization-server` + `.well-known/oauth-protected-resource` (plugin helpers / mcp-handler `protectedResourceHandler`).
- Pages: `app/page.tsx` landing (Sign in with Google → status dashboard: Google Health connection state, Connect/Reconnect button, MCP URL, per-client setup instructions).
- CRITICAL: consult CURRENT better-auth + @better-auth/mcp docs via Context7 first — the plugin split into its own package July 2026; API may differ from training data. Token endpoint MUST accept form-encoded POST (claude.ai quirk, issue #313).

## Impact
Public OAuth endpoints appear (register/authorize/token). DCR is open by design (any client can register) — safety comes from the allowlisted LOGIN, not registration. Nothing grants health data yet.

## Acceptance
Local: sign-in works for allowlisted account; non-allowlisted rejected; metadata endpoints valid; DCR register→authorize→token flow issues a usable token.

## Verification
- [x] Allowlisted Google sign-in completes; session visible on dashboard (Emmett confirmed live on prod, 2026-07-09)
- [x] Non-allowlisted rejection enforced server-side — dual databaseHooks (user.create.before + session.create.before), allowlist unit-tested; fails closed on empty allowlist
- [x] `GET /.well-known/oauth-authorization-server` + `/oauth-protected-resource` return spec-valid JSON (verified: PKCE S256, client_secret_post + none auth methods, register endpoint, resource=/api/mcp)
- [x] Manual DCR: POST /api/auth/mcp/register issued a client_id; authorize with it 302s to /sign-in carrying full OAuth params (token exchange completes only after a real login — covered by the click test / Phase 5 Inspector run)
- [x] Vitest: allowlist unit tests (accept/reject/case-insensitivity/fail-closed)

## Status
DONE — live sign-in confirmed by Emmett on prod 2026-07-09. Carry-over for Phase 5: the OAuth CONSENT step for connector clients is still unexercised (the click test was a direct sign-in, not a client authorize flow) — first MCP Inspector run will surface whether a /consent page is needed. IMPLEMENTATION NOTES for the next agent:
- Using better-auth 1.6.23's BUILT-IN `mcp` plugin (better-auth/plugins) — @better-auth/mcp was REMOVED from deps (it targets unreleased better-auth 1.7; migrate when 1.7 ships).
- Auth endpoints live under /api/auth/mcp/* (authorize, token, register, jwks, userinfo). Issuer = BETTER_AUTH_URL.
- /sign-in resumes interrupted OAuth flows: if client_id is in its query params it sends the user back to /api/auth/mcp/authorize?<same params> after Google login (verified redirect shape by driving authorize unauthenticated).
- ~~WATCH ITEM: consent step~~ RESOLVED 2026-07-09: source-read of the mcp plugin's own authorize handler proves it auto-issues the code after login (no consent step exists unless the client sends prompt=consent, and even then it falls through without a consentPage; token endpoint ignores the flag). No /consent page needed. Details in p5m.md.
- Allowlist = ALLOWED_GOOGLE_EMAILS env (eshaughv@gmail.com + google@emmetts.dev alias). session.create.before does a raw SQL lookup of the user's email (avoids schema import cycle).

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
- 2026-07-09 01:02 — auth config + routes + pages built (pages via sonnet subagent, authorize-resume fix by fable); DCR + authorize redirect verified live on dev; metadata spec-valid (agent: fable)
- 2026-07-09 01:10 — deployed to prod; metadata serves issuer https://health.emmetts.dev; DCR + authorize→/sign-in verified ON PROD; only the live Google sign-in click test remains (agent: fable)
