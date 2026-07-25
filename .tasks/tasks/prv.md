TT;DR: Change the accepted audience to Emmett only, completely offboard Christian, and add visible privacy, disconnect, and stored-Health-data deletion controls.

## Why

Emmett directly authorized removing Christian on 2026-07-25 because he is not using the MCP. Allowlist removal alone does not revoke issued Better Auth MCP tokens or Christian's Google Health connection.

## Scope

Supersede ADR-0001 and update code/docs/memory to one approved identity. Remove Christian from the production allowlist, revoke/delete his Better Auth sessions and OAuth grants, best-effort revoke his Google token, and delete his domain Health rows. Add public privacy disclosure plus authenticated disconnect and Health-data deletion actions. Preserve Emmett's sessions, connection, encrypted tokens, audit history, and Google data.

## Plan

Inventory identity rows by allowlisted email without exposing secrets; implement user-scoped revocation/deletion service and UI; test isolation; perform Christian's production offboarding in a transaction where possible; update production environment and OAuth Audience/Test Users if present.

## Impact

Christian immediately loses access and his local data becomes unrecoverable; Emmett remains the sole user. The destructive scope is explicitly authorized, but exact predicates must be resolved and verified before deletion.

## Acceptance

**Functional bar:** only Emmett can authorize or use the MCP; Christian has no active app/MCP/Health tokens or locally stored Health rows; users can understand and delete stored Health data.
**Evidence bar:** identity-scoped tests, before/after row counts without secret values, production allowlist inspection, and Emmett read continuity.
**Gate ownership:** Emmett authorized Christian's complete offboarding; Google login may require Emmett's interactive approval.
**Valid bounded outcomes:** verified, partial if Google-console state cannot be inspected, or blocked on authentication.
**Budget / stop rule:** never broaden deletion beyond resolved Christian app-user/better-auth identifiers; stop before any ambiguous or shared row.

## Evidence

| Criterion | Oracle / invocation | Raw result or pointer | Interpretation | Limitation | Status |
|---|---|---|---|---|---|
| Operator authorization | Current Codex task, 2026-07-25 | Emmett: “you can probably remove him… It’s only me” | Full Christian offboarding is authorized | Does not itself identify database rows | PASS |
| Production identity inventory | parameterized Neon count query for `[redacted]` | Better Auth user=null; app user=null; all session/token/connection/cache/freshness/inbox/audit/webhook counts=0 | Christian never onboarded, so no destructive DB deletion or Google token revocation existed to perform | Google OAuth Audience UI still needs inspection | PASS |
| Single-user config | local env membership check; `vercel env add ... --force --sensitive` | local and Production allowlist set to Emmett primary+alias; project/webhook/cron vars written | New deployment will activate single-user perimeter | Sensitive Vercel values are write-only by design | PASS |
| Privacy controls | `tests/unit/privacy-routes.test.ts`; production build | Same-origin auth, exact destructive phrase, and resolved-user scoping pass; `/privacy` and both routes built | Controls are identity scoped and visible | Not clicked destructively for Emmett | PASS |
| Production continuity and Google audience | authenticated production MCP reads; Google Auth Platform Audience | MCP 0.2.0 sync/trends/updates pass; app is In production with 1 lifetime user and no Test Users surface | Emmett remains connected; Christian never authorized the app and has no test-user entry to remove | OAuth user cap does not reveal the user's email, so identity is correlated with the sole production DB user | PASS |

## Verification

- [x] ADR, configuration, docs, and task memory define Emmett as the sole approved user
- [x] Christian has zero active Better Auth sessions/MCP tokens/Google Health connection rows
- [x] Christian-linked cache, freshness, webhook, and mutation-audit rows are zero
- [x] Emmett's connection and read tools still work after offboarding
- [x] Privacy disclosure and authenticated disconnect/delete flows pass isolation tests

## Status

DONE. Christian has no app, token, Health, or OAuth-test-user state; Emmett is the sole production user and his authenticated reads continue on 0.2.0.

## Activity

- 2026-07-25 04:05 — created and moved directly to Active after Emmett authorized single-user scope and Christian's removal (agent: codex)
- 2026-07-25 11:00 — production inventory proved Christian has no identity or stored rows; removed him locally and in Vercel Production, accepted ADR-0002, added per-request bearer allowlist checks and privacy/disconnect/delete controls (agent: codex)
- 2026-07-25 11:33 — verified Emmett's production MCP 0.2.0 connection/read continuity and inspected Google Auth Platform: In production, one lifetime OAuth user, and no Test Users surface; Christian never authorized and had nothing further to revoke (agent: codex)
