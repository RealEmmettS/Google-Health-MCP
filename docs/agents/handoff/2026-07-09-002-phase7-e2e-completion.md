# Handoff: Phase 7 E2E Completion — shaughv-health-mcp v1 agent-complete

**Date:** 2026-07-09
**Session:** Continuation (Fable 5, after usage-limit reset — Emmett handed the full build back to Fable)
**Agent:** Claude Code (Fable 5)
**Task/ticket ID(s):** #p7d (Phase 7), milestone #v1

---

## Session Narrative

Emmett originally had Fable plan the whole MCP server and Opus 4.8 execute it. After a usage-limit
reset he changed course: **"I'll let you [Fable] take control of the rest of it. Go ahead and build
out the rest, test it all, make sure it runs, and let me know when you're completely done,"** followed
by **"Deploy everything to production. Merge everything to main when you're done as well."**

By the start of this continuation, Phases 0–6 were built, committed to `main`, deployed to prod, and
live-verified (67 unit tests; read tools 11/11 via `scripts/live-verify.ts`; write tools 21/21 via
`scripts/live-verify-writes.ts`). The one seam not yet exercised end-to-end over deployed HTTP was
**`withMcpAuth` token verification → app-user resolution → tool execution** — i.e. an actual OAuth
access token flowing through the deployed MCP endpoint. This session closed that gap.

## The Plan & Where It Stands

The build plan (`docs/PLAN.md`) is fully executed. Phase status: #p0b #inf #p1d #p2a #p3c #p4g #p5m #p6w
all **DONE**. #p7d is **agent-complete** — everything automatable is proven; only operator connector-adds
remain (see What's Next). Milestone #v1 (target 2026-07-16) is on track; it cannot formally close until
Emmett adds a connector and runs the prompt battery.

## What Was Accomplished (this session)

- **`scripts/live-verify-e2e.ts`** — a headless full-path E2E harness. It:
  1. Reads `/.well-known/oauth-authorization-server`.
  2. DCR-registers a client (RFC 7591).
  3. Mints a better-auth session row and **forges its signed cookie** using the exact better-call scheme
     (`encodeURIComponent(token + "." + base64(HMAC-SHA256(token, secret)))`, key = UTF-8 bytes of
     `BETTER_AUTH_SECRET`; prod cookie name `__Secure-better-auth.session_token`, localhost drops the
     `__Secure-` prefix) — this substitutes for the un-automatable Google login.
  4. Drives PKCE `/authorize` → authorization code.
  5. **Form-encoded `/token` exchange** → `access_token` (+ refresh + id_token).
  6. Calls `/api/mcp` with the Bearer token: `initialize` → `tools/list` → `tools/call`.
  7. Has a **direct-token-insert fallback** (insert an `oauth_access_token` row) so the deployed
     withMcpAuth seam is proven even when the forged cookie can't authenticate.
  8. Cleans up every row it creates (session, token, DCR client — the client delete cascades).
- **Ran it green against both environments:**
  - **localhost:3000** — the FULL real chain passed (register → PKCE authorize with real session cookie
    → form-encoded token exchange → MCP calls). Token endpoint returned
    `access_token,token_type,expires_in,refresh_token,scope,id_token`.
  - **prod https://health.emmetts.dev** — deployed withMcpAuth seam + live data: `get_today_steps`
    returned **3405 real steps with freshness metadata**, `get_sync_status` showed connected + granted
    scopes, `ping` authenticated as the correct better-auth user id, unauthenticated `/api/mcp` → 401 +
    WWW-Authenticate. (The forged-cookie authorize step failed on prod only because local
    `BETTER_AUTH_SECRET` ≠ prod's — expected and harmless; the fallback carried it.)
- **Board updated:** `.tasks/tasks/p7d.md` (verification checked off with evidence, operator items
  waived with reasons, Status + Activity), `.tasks/TASKS.md` Active line.

## Key Decisions

- **Split `BETTER_AUTH_SECRET` across envs is fine — left as-is.** The secret gates only session-cookie
  signing; MCP access tokens are validated by plain DB lookup (`oauthAccessToken.accessToken`, plaintext,
  with an expiry check — verified in better-auth source), so tokens are portable across envs but login
  cookies are env-scoped. Not aligning the secrets is mildly *good* for security (can't forge a prod
  session from a local secret) and avoids a risky rotation. **Do NOT rotate/align it.** (Contrast:
  `TOKEN_ENCRYPTION_KEY` MUST stay shared — rotating it orphans all stored Google tokens.)
- **Chose a hybrid E2E (real chain on localhost + deployed-seam proof on prod)** over forcing the forged
  cookie to work on prod. Real clients get their session via Google login, not a forged cookie, so the
  forged-cookie-on-prod path was never a real requirement — proving the token-endpoint form-encoding
  (localhost) and the deployed withMcpAuth verification (prod) together covers the whole surface.
- **Kept #p7d Active, not Done.** The real-client connector-adds genuinely haven't happened and only
  Emmett can do them; marking Done would overclaim. Status makes "agent scope complete" explicit.

## How It Works

Run `npx tsx scripts/live-verify-e2e.ts [baseUrl] [email]`. Defaults: `https://health.emmetts.dev`,
`eshaughv@gmail.com`. Against prod it proves the deployed seam via the fallback; against a locally-running
dev server (`npm run dev`, matching secret) it proves the entire real OAuth chain. Needs
`.env.development.local` (DATABASE_URL, BETTER_AUTH_SECRET). It writes only throwaway rows and deletes
them before exit.

## Known Issues & Limitations

- **Forged cookie can't authenticate against prod** (local≠prod secret). By design; not a bug. To run the
  full real chain, target localhost.
- **Two documented Google API server-side bugs remain** (unchanged this session): nutrition-log PATCH
  500s on every body/mask variant → `update_nutrition_log` uses replace semantics (create new + delete
  old); `updateProfile` 403s `MISSING_OAUTH_SCOPE` despite the scope being on the token → `update_profile`
  tool dropped (service kept for re-enable). See `.tasks/tasks/p6w.md`.
- **Connector-adds + NL prompt battery + 1-week refresh recheck** are operator/time-gated (below).

## Important Context for Future Sessions

- Prod: `main` @ `f376b28` (Phase 6) is deployed and live-verified; this session's new files
  (`scripts/live-verify-e2e.ts`, this handoff, board md) are **non-runtime** — the running app is
  unchanged, so no redeploy is functionally required (push = the "merge to main" Emmett asked for).
- Vercel env vars are Sensitive/write-only (`vercel env pull` returns them empty). Canonical secret
  copies live in `.env.development.local` + `.tasks/secure/`.
- Deployment Protection must stay **preview-only** — prod must remain open (the app brings its own auth).
- Vercel CLI is NOT installed; the auto-deploy webhook has been flaky (one push deployed manually before).

## What's Next

**Agent work is complete.** Remaining items are Emmett's, in priority order:

1. **Add the custom connector in each client and run the prompt battery** (the real acceptance test):
   - Claude Code: `claude mcp add --transport http health https://health.emmetts.dev/api/mcp` → OAuth
     browser dance → ask "how many steps do I have today?"
   - claude.ai (web + mobile): Settings → Connectors → Add custom connector → the same URL → OAuth.
   - ChatGPT: custom connector via DCR.
   - Battery: steps / goal / sleep / why tired / why HR high / food yesterday / exercise this week +
     log/edit/delete a snack + log water + update weight. Every underlying tool is already live-verified.
2. **Recheck refresh-token survival ~2026-07-17** (app is published to production, so the 7-day Testing
   expiry shouldn't apply; MCP refresh window is 60 days).
3. **Optional / gated:** #7le — SHAUGHV design pass on the `health.emmetts.dev` dashboard
   (`/shaughv-design`, centered, no nav-bar). Gated on #p7d; do not start without Emmett's go-ahead.
