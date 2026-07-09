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
- [ ] Allowlisted Google sign-in completes; session visible on dashboard
- [ ] Non-allowlisted Google account is rejected server-side (test with a second account or unit-test the hook)
- [ ] `GET /.well-known/oauth-authorization-server` + `/oauth-protected-resource` return spec-valid JSON
- [ ] Manual DCR: POST /register → authorize (browser) → form-encoded POST /token yields access token
- [ ] Vitest: allowlist hook unit tests (accept/reject/case-insensitivity)

## Status
Not started. Prereq: #p1d (DB + better-auth tables).

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
