TT;DR: Promote the private Google Health MCP to stable 1.0.0 after upgrading it to the 2026 request-scoped protocol and stateless JWT authorization on Vercel Fluid beside Neon in `iad1`.

## Why

The 2026-07-28 MCP protocol and official TypeScript SDK v2 remove transport sessions and make request-scoped serverless deployment a first-class path. The current service remains healthy, but it carries a legacy transport wrapper and a deprecated Better Auth MCP compatibility bridge whose opaque-token refresh semantics are deliberately time-boxed.

## Scope

Includes the stable 1.0.0 product/server identity; native MCP SDK v2 with modern and stateless-legacy compatibility; structured tool contracts, cache hints, and safe telemetry; Node 24/Fluid/`iad1`; stable Better Auth OAuth Provider with audience-bound RS256 JWTs; additive OAuth and Google DPoP tables; branded private consent UI; Makira/Gail Rock typography; connector qualification; and a rollback/soak window. Excludes MCP Tasks, subscriptions, MRTR, public access, medical reasoning, Railway, Edge Functions, and closure of the independent physical Fitbit webhook gate.

## Plan

1. Ship 0.2.1 as a transport/runtime-only checkpoint with legacy OAuth preserved.
2. Prove modern and existing connector compatibility in production.
3. Rehearse and apply additive auth/DPoP migrations, then ship the historical 0.3.0 cutover.
4. Promote the proven 0.3.0 line to stable 1.0.0 without changing protocol or product behavior.
5. Reconnect active connectors and Google Health consent once, monitor for 24 hours and seven days, then retire legacy OAuth data only after acceptance.

## Status

ACTIVE. Stable 1.0.0 is live from exact release commit `7ae1846` as production deployment
`dpl_GDMnWWd37UB1FwZ6sWoJtiyuTGe5` in `iad1`. Local modern/legacy identity tests, all 149 tests,
typecheck/build, canonical health/OAuth/MCP boundaries, an existing authenticated MCP ping, exact
live icon identity, and error/fatal log scans pass. Checkpoint 0.2.1, the DPoP-capable legacy-auth
recovery artifact, and the production 0.3.0 cutover remain recorded. Owner reconnect/signed-in
auth, Google DPoP reconsent/refresh, and the timed soak remain open.

## Activity

- 2026-07-29 01:45 - Created from Emmett's approved full implementation plan; preserved the separate v1.1 physical webhook acceptance gate and split production work into two revertible releases. (agent: codex)
- 2026-07-29 03:58 - Completed the 0.3.0 implementation/rehearsal stage without touching
  production schema or replacing credentials. Independent OAuth, release/UI, and DPoP audits
  drove the resource/redirect/no-store, refresh-race, lock-duration, consent, typography, and
  rollback-epoch corrections. (agent: codex)
- 2026-07-29 04:15 - Applied the additive production schema with all legacy/Google aggregates
  preserved, then production-qualified DPoP-capable legacy-auth recovery deployment
  `dpl_E8TFtPHHZ4SXh2FJLRcoTUGzfjqj` through two pings and a non-mutating live read. (agent: codex)
- 2026-07-29 04:25 - Deployed 0.3.0 as `dpl_5h11asJsx4hRJkrebvANHqRrkdTZ`; anonymous OAuth/MCP
  security gates, synthetic DCR cleanup, public responsive/font/accessibility QA, clean build logs,
  and zero clustered runtime errors passed. Approval-gated identity/credential steps remain open.
  (agent: codex)
- 2026-07-31 09:40 - Emmett designated the proven SDK v2/0.3.0 line as the full stable 1.0.0
  release. Began the metadata/docs/board promotion while preserving every historical cutover
  receipt and keeping webhook, reconsent, connector, soak, and destructive-cleanup gates open.
  (agent: codex)
- 2026-07-31 09:43 - Committed the 1.0.0 source promotion as `7ae1846`; the focused 7-test
  protocol identity suite, full 149-test suite, typecheck, production build, diff checks, and
  exact 1254px icon identity all pass. Production deployment proof is next. (agent: codex)
- 2026-07-31 09:47 - Production deployment `dpl_GDMnWWd37UB1FwZ6sWoJtiyuTGe5` reached READY
  in `iad1` on exact commit `7ae1846` with the canonical alias. Health/OAuth/401 no-store,
  authenticated MCP ping, exact live icon, and error/fatal log checks pass; remaining owner and
  soak gates stay open. (agent: codex)
