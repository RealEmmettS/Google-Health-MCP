TT;DR: Upgrade the private Google Health MCP to the 2026 request-scoped protocol and stable stateless JWT authorization while keeping Node.js Functions on Vercel Fluid beside Neon in `iad1`.

## Why

The 2026-07-28 MCP protocol and official TypeScript SDK v2 remove transport sessions and make request-scoped serverless deployment a first-class path. The current service remains healthy, but it carries a legacy transport wrapper and a deprecated Better Auth MCP compatibility bridge whose opaque-token refresh semantics are deliberately time-boxed.

## Scope

Includes native MCP SDK v2 with modern and stateless-legacy compatibility, structured tool contracts, cache hints and safe telemetry, Node 24/Fluid/`iad1`, stable Better Auth OAuth Provider with audience-bound RS256 JWTs, additive OAuth and Google DPoP tables, branded private consent UI, Makira/Gail Rock typography, connector qualification, and a rollback/soak window. Excludes MCP Tasks, subscriptions, MRTR, public access, medical reasoning, Railway, Edge Functions, and closure of the independent physical Fitbit webhook gate.

## Plan

1. Ship 0.2.1 as a transport/runtime-only checkpoint with legacy OAuth preserved.
2. Prove modern and existing connector compatibility in production.
3. Rehearse and apply additive auth/DPoP migrations, then ship 0.3.0.
4. Reconnect active connectors and Google Health consent once, monitor for 24 hours and seven days, then retire legacy OAuth data only after acceptance.

## Status

ACTIVE. The board is upgraded to task plugin 1.1.1 and the 0.2.1 implementation checkpoint is underway. Existing Google Health data, auth tables, webhook state, and production deployment remain untouched at this point.

## Activity

- 2026-07-29 01:45 - Created from Emmett's approved full implementation plan; preserved the separate v1.1 physical webhook acceptance gate and split production work into two revertible releases. (agent: codex)
