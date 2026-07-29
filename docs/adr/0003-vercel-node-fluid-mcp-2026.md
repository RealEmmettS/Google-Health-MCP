# ADR-0003: Keep the MCP on Vercel Node.js Functions with Fluid Compute

- **Status:** Accepted
- **Date:** 2026-07-29
- **Decision owner:** Emmett Shaughnessy
- **Related:** ADR-0002 (Emmett-only audience), `#mcp2`, `#sdk2`, `#oap`, `#rlw`

## Context

The 2026-07-28 Model Context Protocol and official TypeScript SDK 2.0 make the remote transport request-scoped and sessionless. The Fetch-compatible handler can run on Edge/serverless platforms, prompting a fresh hosting review rather than an automatic continuation of the old architecture.

This application is a private, single-user Next.js service with four separate trust layers. Its MCP request path uses Node cryptography, Better Auth, a pooled Neon database in US East, AES-256-GCM-encrypted Google Health refresh credentials, Google APIs, encrypted short-lived cache, webhook/update state, and audit records. The protocol transport can be stateless; those application responsibilities cannot.

The live baseline is healthy on Vercel: Node 24 functions are already in `iad1`, beside Neon, with no recent runtime errors and green source gates. Current OAuth registrations/refresh grants require a rollback-safe cutover rather than a host rewrite at the same time.

## Options considered

1. Vercel Node.js Functions with Fluid Compute in `iad1`.
2. Vercel Edge Functions.
3. Cloudflare Workers/Agents with edge state services.
4. Railway long-running Next.js or FastMCP service.
5. A global edge gateway in front of a regional Node/auth/data core.

## Decision

Keep `health.emmetts.dev` on **Vercel Node.js Functions with Fluid Compute in `iad1`**.

- Use Node 24 and the official SDK v2 request-scoped handler.
- Create one MCP server per request; store no transport session and emit no `Mcp-Session-Id` for modern traffic.
- Retain stateless legacy protocol fallback until telemetry proves connector migration.
- Verify MCP access JWTs locally, while keeping necessary authorization and Google credential state durable.
- Set a 60-second MCP maximum and do not add background Tasks/subscriptions without a durable design.
- Keep Neon pooled runtime access in the same region.
- Preserve two rollback-safe production artifacts: 0.2.1 transport/runtime, then 0.3.0 auth/DPoP/UI.

## Rationale

### Compatibility and security

Node preserves the exact crypto, Better Auth, database, Next.js, and test environment already proven by the service. Edge portability of the SDK does not make every application dependency Edge-compatible. Moving auth and encrypted token handling to a less compatible runtime during a protocol/auth migration would combine independent risks.

### Data locality and latency

Useful requests reach regional Neon and often Google. A globally distributed front end would still pay the regional/backend hop; it would mainly optimize the smallest part of the request. `iad1` keeps the function beside current database infrastructure. The 0.2.1 acceptance gate will measure warm authenticated `ping` rather than assuming improvement.

### Vercel platform direction

Vercel's current Edge documentation recommends Node for improved performance and reliability, while Fluid Compute brings optimized concurrency, bytecode reuse, streaming, active-CPU billing, and longer function durations to Node. The modern MCP transport needs request streaming, not an Edge-only primitive.

### Cost and operations

No new host/service is introduced, so the expected fixed incremental cost is zero. Railway would add a production subscription/cutover without a current long-running-process need. Cloudflare or split hosting would add a second platform, deployment model, and trust boundary before demonstrating a performance problem.

## Consequences

### Positive

- Minimal host migration surface during a high-risk transport/auth change.
- Full Node/npm compatibility and regional database locality.
- Existing Vercel aliases, environment store, previews, logs, deployments, and rollback remain usable.
- Fluid concurrency can reuse warm schema/auth verifier initialization without retaining request data.
- The architecture remains portable at the handler/service boundary.

### Negative and bounded tradeoffs

- Client-to-function network latency is not globally minimized.
- Durable state remains regionally concentrated.
- Vercel metering and deployment conventions remain operational dependencies.
- Any future long-lived subscription/task system needs a durable external bus/queue.
- Exact billing tier cannot be confirmed through the current connector; any paid-plan prompt is a stop condition.

## Vercel-specific migration surface

- Vercel environment-variable store.
- Neon Marketplace attachment/env injection (database itself remains ordinary Neon).
- `health.emmetts.dev` DNS/production alias and Vercel deployment protection.
- Git-driven Vercel deploy/rollback workflow.
- `preferredRegion = "iad1"`, Fluid Function settings, and cron configuration.

The MCP server factory, health services, schemas, OAuth concepts, Drizzle models, Google client, and tests remain host-neutral TypeScript/HTTP code. New Vercel-specific features must be added to `#rlw`'s migration inventory.

## Reevaluation triggers

Reopen hosting only when at least one measurable condition appears:

- durable application state becomes globally edge-native;
- a supported client requires `subscriptions/listen` and durable multi-instance pub/sub;
- routine work exceeds the 60-second budget and needs a resident worker/task queue;
- measured Vercel latency, reliability, or cost is materially worse than a tested alternative;
- team-standard FastMCP/Railway operation becomes more valuable than the current integrated auth/Next.js surface.

## Evidence and references

- [MCP 2026 transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [MCP 2026 authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [SDK v2 migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute)
- [Vercel Edge runtime](https://vercel.com/docs/functions/runtimes/edge)
- [Vercel Function pricing](https://vercel.com/docs/functions/usage-and-pricing)
- [Cloudflare remote MCP](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Railway pricing](https://docs.railway.com/pricing)
- [Full dated research report](../research/2026-07-29-mcp-sdk-v2-and-hosting.md)
