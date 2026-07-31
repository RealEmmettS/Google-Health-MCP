# shaughv-health-mcp

A **private, single-user remote MCP server** on Vercel for Emmett. His trusted LLM
assistants — Claude Code / Claude Desktop, claude.ai (web + mobile connectors), and ChatGPT
connectors — can **read** his Google Health data ("How many
steps today?", "How did I sleep?", "Why am I tired?", "What did I eat yesterday?") and
**write** the things a wearable can't track itself: nutrition, hydration, and body
measurements.

It is a **thin, typed, authenticated data adapter** over the
[Google Health API](https://developers.google.com/health) (`health.googleapis.com/v4`).
The LLM does the reasoning; this server returns accurate data with timestamps, units, and
**freshness metadata** on every response. It is **not** a health warehouse, an analytics
product, or anything that diagnoses — there are no medical claims anywhere in the surface.

> **`docs/PLAN.md` is the build plan and the source of truth** for architecture, the four
> auth layers, the database schema, the tool surface, the watchouts, and the E2E
> verification bar. Accepted architecture decisions under **`docs/adr/`** govern their
> specific scope; [ADR-0002](docs/adr/0002-single-user-private.md) fixes the Emmett-only
> audience while ADR-0001 records the private/unverified posture. This README is the human front door.
> Live phase/task status is on the `.tasks/` board — see [Task board](#task-board).

---

## Table of contents

- [What it is / what it is not](#what-it-is--what-it-is-not)
- [Who it's for and how it's used](#who-its-for-and-how-its-used)
- [Architecture](#architecture)
- [The four auth layers (never conflate)](#the-four-auth-layers-never-conflate)
- [Tech stack](#tech-stack)
- [Current status](#current-status)
- [Repository structure](#repository-structure)
- [Setup guide](#setup-guide)
  - [1. Accounts and services](#1-accounts-and-services)
  - [2. Google OAuth redirect URIs](#2-google-oauth-redirect-uris)
  - [3. Environment variables](#3-environment-variables)
  - [4. Local development](#4-local-development)
  - [5. Deploy](#5-deploy)
- [Connecting an MCP client](#connecting-an-mcp-client)
- [MCP surface](#mcp-surface)
- [Security posture](#security-posture)
- [Troubleshooting](#troubleshooting)
- [Task board](#task-board)
- [Further reading](#further-reading)

---

## What it is / what it is not

| It **is** | It **is not** |
|---|---|
| A remote MCP server (streamable HTTP) on Vercel | A local/stdio MCP server |
| A thin, typed adapter over `health.googleapis.com/v4` | A data warehouse or ETL pipeline |
| Read access to activity, sleep, heart, nutrition | An analytics or dashboard product |
| Write access for nutrition, hydration, measurements | A writer of sleep / exercise / settings (absent **by design**) |
| Private and allowlist-only (Emmett's two approved aliases) | Public or self-service multi-tenant |
| A returner of data + freshness metadata + units | A source of diagnoses, advice, or medical claims |

The device data path is **never live** — a Fitbit Air syncs to the Fitbit app, which
pushes to the Google Health cloud, which this server reads on demand. Every response
therefore carries `freshness` metadata (`retrievedAt`, `latestDataTime?`, `isPossiblyStale`,
`note`) so the LLM can distinguish "no data synced yet" from "nothing happened."

## Who it's for and how it's used

**Audience:** Emmett, through either approved alias, and the LLM assistants he authorizes.
Nobody else can sign in: the exact approved identities are fixed by
[ADR-0002](docs/adr/0002-single-user-private.md), and enforced through
`ALLOWED_GOOGLE_EMAILS`.

**Intent — how Emmett uses it.** He asks his assistants natural questions and expects
grounded answers with real numbers, timestamps, and freshness notes:

- "How many steps do I have today? What's left to hit my goal?"
- "How did I sleep last night?" / "Why am I tired?"
- "Why is my heart rate so high?" (latest **synced** HR, explicitly not live)
- "What did I eat yesterday?" / "What's my exercise looking like this week?"
- "Log a snack: Greek yogurt, 150 cal, 15 g protein." / "Edit that to 180 cal." / "Delete it."
- "Log 16 oz of water." / "Update my weight to X."

Writes are the reason the server exists at all beyond read-only: a Fitbit Air does not
track food, water, or manual measurements, so the LLM logs them through validated,
audit-logged write tools. Every mutation is explicit-input-only (never inferred) and leaves
an audit row.

**Future directions** (parked on the board; see [Task board](#task-board)):
- **`#api`** — a plain REST API surface (bearer/PAT-authenticated) over the same health
  services, so Emmett's own scripts/apps can call the data without an OAuth dance.
  Feasibility analyzed: feasible and additive on the current stack.
- **`#rlw`** — closed by [ADR-0003](docs/adr/0003-vercel-node-fluid-mcp-2026.md): retain
  Vercel Node 24 + Fluid in `iad1`; reconsider Edge/Workers/Railway only on measured triggers.
- **`#w11`** — **v1.1 webhooks**: implemented endpoint/signature/ledger/inbox; production
  subscriber registration and a real sync are the final live gates.

## Architecture

```
                    ┌─────────────┐   Bluetooth sync   ┌──────────────┐
   Fitbit Air ─────▶│  Fitbit app  │ ─────────────────▶│ Google Health │
   (wearable)       │  (phone)     │                    │    cloud     │
                    └─────────────┘                     └──────┬───────┘
                                                               │  Google Health API
                                                               │  health.googleapis.com/v4
                                                               │  ▲ DPoP-bound refresh token
                                                               │  │  (AES-256-GCM
                                                               │  │   encrypted in Neon)
                                                               ▼  │
   ┌───────────────────────────┐   OAuth 2.1 + DCR    ┌────────┴──────────────────────┐
   │  LLM client               │ ───────────────────▶ │  Next.js on Vercel            │
   │  Claude Code / Desktop    │                       │  (health.emmetts.dev)         │
   │  claude.ai web + mobile   │ ◀─────────────────── │                               │
   │  ChatGPT connector        │   MCP tools/resources │  ┌─────────────────────────┐  │
   └───────────────────────────┘                       │  │ MCP SDK v2   → /api/mcp │  │
                                                        │  │ better-auth  → OAuth AS │  │
                                                        │  │ Google Health client    │  │
                                                        │  └───────────┬─────────────┘  │
                                                        └──────────────┼────────────────┘
                                                                       │ Drizzle ORM
                                                                       ▼
                                                             ┌──────────────────┐
                                                             │  Neon Postgres    │
                                                             │  encrypted tokens │
                                                             │  audit log        │
                                                             │  webhook tables   │
                                                             │  (dormant, v1.1)  │
                                                             └──────────────────┘
```

**Request path in one line:** an LLM client completes OAuth 2.1 + S256 PKCE (with Dynamic
Client Registration) against *this app's own* authorization server, gets a one-hour RS256 JWT
bound to `/api/mcp`, and presents it on every request. The MCP route verifies that JWT locally,
then a tool handler fetches Google Health with the decrypted-on-demand Google credential,
bounds/normalizes the payload, and returns it with freshness metadata.

### The four auth layers (never conflate)

These are four **separate** things. Confusing them is the number-one source of bugs here.

| # | Layer | What it is | Status |
|---|---|---|---|
| 1 | **Vercel account login** | Emmett's Vercel dashboard access | Irrelevant to runtime |
| 2 | **Neon Auth** | Neon's own auth product | **Disabled** — Neon is only a database |
| 3 | **Google Health consent** | Health-scope OAuth; refresh credentials and the per-connection DPoP private key are **AES-256-GCM encrypted** in Neon; done once per (re)connect | Custom routes under `/api/auth/google-health/*` |
| 4 | **MCP client auth** | This app **is** an OAuth 2.1 authorization server (`@better-auth/oauth-provider`, public DCR, S256 PKCE, hashed rotating refresh tokens, audience-bound JWTs); Google Sign-In is identity only and is restricted to `ALLOWED_GOOGLE_EMAILS` | Endpoints under `/api/auth/oauth2/*` + `/.well-known/*` |

Layers 3 and 4 use the **same** Google OAuth client ID but separate flows and scopes. Layer
4's login uses basic `openid email profile` scopes only; layer 3 requests the nine
`googlehealth.*` scopes. The health-flow refresh token is the one that gates data access.

## Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router) | Server-centric; all API routes on the **Node runtime** (never edge — needs `node:crypto` + the DB driver) |
| Language | **TypeScript 5.9** | Pinned to `^5`: Next 16's build-time type checker cannot load the TS 7 native compiler (see [Troubleshooting](#troubleshooting)) |
| MCP transport | **`@modelcontextprotocol/server` 2.0.0** | 2026 request-scoped HTTP plus stateless 2025 fallback; one server per request, no transport session. See [ADR-0003](docs/adr/0003-vercel-node-fluid-mcp-2026.md). |
| Auth server | **better-auth 1.6.25** + **`@better-auth/oauth-provider` 1.6.25** | Stable maintained provider, public DCR, S256 PKCE, consent, one-hour exact-audience RS256 JWTs, hashed rotating 60-day refresh tokens; no beta CIMD |
| Database | **Neon Postgres** + **Drizzle ORM** (`@neondatabase/serverless`) | **Pooled** URL at runtime, **unpooled** URL for migrations |
| Time | **Luxon** | Timezone-correct ranges (default `America/Chicago`), DST-safe, sleep-crosses-midnight logic |
| Validation | **Zod 4** | Tool input schemas; write-tool validation |
| Tests | **Vitest** (+ MSW / undici mocks) | Unit + mocked-API integration |
| Host | **Vercel Node 24 + Fluid Compute in `iad1`** | Canonical domain **`health.emmetts.dev`**; Deployment Protection is preview-only (production must stay open — the app brings its own auth) |

## Current status

Milestone **`#v1` is complete and live**; the **`#mcp2` / 1.0.0** stable-release milestone owns
the remaining rollout qualification and soak. The `.tasks/` board remains the source of truth.

- **1.0.0 is the stable release at `health.emmetts.dev`** on Vercel Node 24 + Fluid in `iad1`.
  The implementation identity reports 1.0.0 while the MCP protocol SDK remains independently
  pinned to 2.0.0. The existing SEP-973 icon metadata references the canonical hosted PNG;
  clients decide whether to render it. The
  DPoP-capable legacy-auth recovery deployment is retained separately so connector reconnect,
  Google reconsent, and soak evidence are not conflated with deployment success.
- The MCP endpoint exposes 18 tools and 6 resources through request-scoped SDK v2 transport,
  with a stateless 2025 fallback for older connectors.
- Google Health consent, encrypted token storage/refresh, identity mapping, reads, writes,
  audit logging, and freshness behavior have been verified against real data.
- The stable provider's production metadata, RS256 JWKS, public DCR, exact resource/form boundary,
  scoped MCP challenges, and no-store behavior pass. Existing clients must reconnect once for the
  new `/api/auth/oauth2/*` endpoints/scopes; signed-in connector and time-based soak gates remain
  explicit on `#q2` rather than being inferred from anonymous tests.
- Google Health webhook implementation exists under **v1.1** (`#w11`), but its unrelated real
  Fitbit delivery gate remains open.

## Repository structure

```
.
├── docs/PLAN.md                    ← SOURCE OF TRUTH (architecture, decisions, phases, E2E bar)
├── docs/adr/                       ← accepted architecture decision records
├── README.md                       ← this file (human front door)
├── CLAUDE.md                       ← agent instructions for Claude sessions
├── AGENTS.md                       ← agent instructions, tool-neutral (Codex/Cursor/etc.)
├── .env.example                    ← every env var, documented by name
├── package.json                    ← scripts + pinned deps
├── next.config.ts / tsconfig.json / drizzle.config.ts / vitest.config.ts
│
├── app/                            ← Next.js App Router
│   ├── layout.tsx · page.tsx       ← landing / status dashboard
│   ├── icon.svg                     ← local Google Health MCP favicon
│   ├── sign-in/page.tsx            ← Google sign-in (resumes interrupted OAuth flows)
│   ├── consent/page.tsx            ← private OAuth read/write consent
│   ├── components/sign-out-button.tsx
│   ├── api/
│   │   ├── [transport]/route.ts              ← live MCP endpoint (`/api/mcp`)
│   │   ├── auth/[...all]/route.ts           ← better-auth sign-in + /oauth2 authorize/token/register/userinfo/JWKS
│   │   ├── auth/google-health/start/route.ts    ← health-consent redirect (session-gated)
│   │   ├── auth/google-health/callback/route.ts ← code exchange → encrypt+store → identity map
│   │   └── health/status/route.ts          ← healthcheck (no secrets)
│   └── .well-known/
│       ├── oauth-authorization-server/route.ts
│       └── oauth-protected-resource/route.ts
│
├── src/
│   ├── auth/           ← auth.ts (better-auth config), allowlist, app-user resolution,
│   │                     state (health-consent CSRF state), token-service (single-flight
│   │                     refresh), JWT bearer boundary, DPoP, token-store, google-health-oauth
│   ├── db/             ← domain + legacy/new additive auth schemas, client.ts
│   ├── security/       ← encryption.ts (AES-256-GCM), redact.ts
│   ├── audit/          ← mutation-audit.ts (insert-only audit writer)
│   ├── google-health/  ← typed API client, data-type registry, scopes, and errors
│   ├── time/           ← timezone-safe physical/civil range helpers
│   ├── health-services/ ← shared orchestration layer (also enables future #api)
│   └── mcp/            ← thin tool and resource registration
│
├── drizzle/            ← generated SQL migrations + meta
├── scripts/db-inspect.mjs   ← utility: list/inspect Neon tables
├── tests/unit/         ← default Vitest security, protocol, service, and OAuth coverage
├── tests/integration/  ← opt-in isolated-Postgres atomic credential-replacement proof
└── .tasks/             ← the task board (see "Task board")
```

The 0.3.0 migration adds isolated `mcp_oauth_*_v2` provider tables and
`google_health_dpop_key`. Legacy OAuth client/token/consent tables remain untouched for the
seven-day rollback window; health connections, encrypted tokens, caches, webhook data, and
audit history are not migrated or deleted.

## Setup guide

### 1. Accounts and services

1. **Google Cloud** — enable the Google Health API; configure the OAuth consent screen with
   the `googlehealth.*` scopes; create an OAuth **web** client; add the redirect URIs below;
   **publish the app to "In production"**. Publishing is essential: in *Testing* status
   Google expires refresh tokens after **7 days** (`refresh_token_expires_in: 604799`). The
   "unverified app" badge that appears after publishing is expected and stays — **do not**
   submit for verification. Public verification and CASA were evaluated and rejected in
   [ADR-0001](docs/adr/0001-private-allowlist-only.md).
2. **Vercel** — import this repo as a project. Framework auto-detects as Next.js. Keep
   **Deployment Protection = preview-only** (production must stay open so programmatic MCP
   clients can reach it; the app enforces its own auth).
3. **Neon** — the Postgres database was provisioned and connected from the Vercel dashboard
   through its Storage/Marketplace integration; it is not a separately operated application
   service. The integration injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`
   automatically. Neon Auth is disabled.

### 2. Google OAuth redirect URIs

One web client serves **both** the better-auth sign-in flow (`/api/auth/callback/google`)
and the Google Health consent flow (`/api/auth/google-health/callback`). Canonical domain:
**`health.emmetts.dev`**; the Vercel-assigned `google-health-mcp-realemmetts.vercel.app` also
serves. Register all six:

```
https://health.emmetts.dev/api/auth/callback/google
https://health.emmetts.dev/api/auth/google-health/callback
https://google-health-mcp-realemmetts.vercel.app/api/auth/callback/google
https://google-health-mcp-realemmetts.vercel.app/api/auth/google-health/callback
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/auth/google-health/callback
```

Requested health scopes (nine, minimum-necessary — `location`/`ecg`/`irn` are configured on
the consent screen but not requested; there is no `settings.writeonly`):

```
Read : googlehealth.activity_and_fitness.readonly
       googlehealth.health_metrics_and_measurements.readonly
       googlehealth.sleep.readonly
       googlehealth.nutrition.readonly
       googlehealth.profile.readonly
       googlehealth.settings.readonly
Write: googlehealth.nutrition.writeonly
       googlehealth.health_metrics_and_measurements.writeonly
       googlehealth.profile.writeonly
```

### 3. Environment variables

Every variable is documented by name in **`.env.example`**. Values are never committed —
locally they live in `.env.development.local` (gitignored); in production they live in the
Vercel env store. **Never** put secret *values* in code, logs, the task board, or any
markdown.

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Pooled Neon connection (runtime) | Injected by the Neon integration |
| `DATABASE_URL_UNPOOLED` | Direct Neon connection | Used **only** by `drizzle-kit` migrations |
| `GOOGLE_CLIENT_ID` | Google OAuth client id | One client serves both flows |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 AES-256-GCM key | Environments sharing this Neon database must share this key. Losing or splitting it orphans stored tokens (reconnect required) |
| `BETTER_AUTH_SECRET` | better-auth signing secret | |
| `BETTER_AUTH_URL` | Auth issuer / base URL | `http://localhost:3000` local · `https://health.emmetts.dev` prod |
| `NEXT_PUBLIC_APP_URL` | Public app URL | Matches `BETTER_AUTH_URL` per environment |
| `ALLOWED_GOOGLE_EMAILS` | Comma-separated allowlist | Fail-closed perimeter; exactly Emmett's two aliases per ADR-0002 |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | Google Health webhooks | Numeric project identifier |
| `GOOGLE_HEALTH_SUBSCRIBER_ID` | Google Health webhooks | Stable subscriber name |
| `WEBHOOK_AUTH_SECRET` | Google Health webhooks | Full configured Authorization header value |
| `CRON_SECRET` | Daily retention maintenance | Raw random value sent by Vercel as a Bearer secret |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

### 4. Local development

```bash
npm install
cp .env.example .env.development.local     # then fill in values
npm run dev                                # http://localhost:3000
npm test                                   # Vitest
npm run typecheck                          # tsc --noEmit
npm run db:generate                        # generate a Drizzle migration from schema changes
npm run db:migrate                         # apply migrations (uses DATABASE_URL_UNPOOLED)
node scripts/db-inspect.mjs                # list/inspect Neon tables
```

Local sign-in needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` populated and the
`localhost:3000` redirect URIs registered (both are in place). The dev box is Windows —
**all npm scripts must be cross-platform**.

### 5. Deploy

Push to `main`; Vercel builds and deploys. Migrations are run from a dev machine against the
unpooled Neon URL (`npm run db:migrate`), not in the build. Production env-var changes only
take runtime effect on the **next deploy**. Note: an auto-deploy webhook has occasionally not
fired on push — if a deploy doesn't appear, deploy manually via the Vercel CLI.

For 0.3.0 sequencing, rollback epochs, fresh-approval boundaries, and cleanup rules, use the
[0.3.0 cutover runbook](docs/operations/0.3.0-cutover.md).

## Connecting an MCP client

> The production endpoint is live. Each client walks the OAuth flow and an approved person
> signs in with their allowlisted Google account.

Clients previously authorized against `/api/auth/mcp/*` must remove/re-add the connector once
so discovery can use `/api/auth/oauth2/*`. The public MCP URL itself does not change.

- **Claude Code:**
  `claude mcp add --transport http health https://health.emmetts.dev/api/mcp`
- **claude.ai (web + mobile):** Settings → Connectors → Add custom connector →
  `https://health.emmetts.dev/api/mcp` → complete OAuth.
- **ChatGPT:** Add a custom connector — it registers itself via Dynamic Client Registration.

## MCP surface

Defined in `docs/PLAN.md` §"MCP surface (v1)"; input schemas per the handoff spec §11. Every
read response carries `freshness` + units and is payload-bounded (default pageSize ≤ 100; HR
series summarized via rollups; truncation notes when capped).

**Read tools (11, + `ping`):** `get_today_steps`, `get_sleep_summary`, `get_latest_heart_rate`,
`get_exercise_week`, `get_nutrition_log`, `get_health_context` (bundle: sleep + latest HR +
resting HR/HRV + recent activity + nutrition — data only, no conclusions),
`get_health_trends` (bounded 7/30/90-day coverage-aware summaries), `get_health_updates`
(durable local notification inbox), `query_health_data` (generic list/reconcile,
registry-allowlisted), `rollup_health_data`, and `get_sync_status`.

Notable behaviors: `query_health_data` auto-builds the right filter per record type — including
the civil `date` field for `daily-*` aggregates, which carry no physical timestamp (a
sample-time filter would silently return everything); use `mode: "reconcile"` for Google's
merged/deduped stream when multiple sources log the same metric. `get_sleep_summary`
distinguishes `STAGES` (deep/light/REM) from `CLASSIC` sessions (a single asleep block — a
device capture condition, surfaced via `stagesStatus`, e.g. `REJECTED_COVERAGE`, not poor
sleep). Staleness is cadence-aware: once-per-night metrics (sleep, `daily-*`) don't flag
`isPossiblyStale` for a same-day value; live-ish samples use a 3-hour threshold.

**Mutation/action tools (6):** `create_nutrition_log`, `update_nutrition_log` (replace semantics — the
live PATCH endpoint 500s; a new data-point name is returned), `delete_nutrition_log`,
`create_hydration_log`, `update_measurement` (weight | body-fat | height), and
`acknowledge_health_updates` (local inbox state only). `update_profile`
was **dropped**: the live endpoint 403s despite the granted scope (documented server-side
bug); the service layer is kept for re-enablement.

**Resources (6):** `health://profile`, `health://settings`, `health://connected-user`,
`health://data-types`, `health://freshness`, `health://updates`.

**Absent by design:** sleep, exercise, and settings **writes**; bulk historical writes.

## Security posture

- **Four auth layers, never conflated** (table above). The MCP endpoint requires a valid
  exact-audience JWT with `health:read` (and `health:write` before mutations); signature,
  issuer, audience, expiry, subject, scope, and current email allowlist are checked locally.
  Sign-in is allowlisted to `ALLOWED_GOOGLE_EMAILS`; DCR is open by design
  (any client may *register* — safety comes from the allowlisted *login*, not registration).
  The approved identity and the prohibition on public signup are fixed by
  [ADR-0002](docs/adr/0002-single-user-private.md).
- **Google tokens and DPoP private keys are AES-256-GCM encrypted at rest**
  (`TOKEN_ENCRYPTION_KEY`, with purpose-separated HKDF context and
  `key_version` for rotation). No plaintext tokens in the DB, logs, or error paths — a
  `redact()` helper strips token patterns (`ya29.`, `1//`, `GOCSPX-`, JWTs, `Bearer`/`Basic`,
  Neon `npg_`) before anything is logged.
- **MCP credentials use a different storage model:** provider refresh tokens and public-client
  secrets are hashed; MCP access JWT values are not persisted. A local JWKS cache verifies warm
  requests without a token-table lookup.
- **Token refresh is single-flight** through an atomic, expiring database claim on the token
  row (compatible with the stateless Neon HTTP driver); on refresh failure the connection is
  marked `reauth_required`.
- **The allowlist is rechecked on every MCP bearer request.** Removal blocks tool use
  immediately; complete offboarding still deletes Better Auth sessions/MCP grants and the
  person's stored Google Health connection.
- **Writes** (nutrition / hydration / measurements only) are Zod-validated, explicit-input
  only, and every mutation is audit-logged in `mutation_audit_log`. There are **no** sleep /
  exercise / settings write tools at all.
- **No medical diagnosis language** anywhere; freshness/limitation notes on every response.
- Production stays open (no Vercel SSO wall) on purpose — the application's own auth is the
  perimeter.
- Stable OAuth Provider 1.6.25 has three tracked residuals: its resource-indicator advisory is
  contained by one configured audience plus exact resource/audience boundaries, and refresh
  rotation uses predecessor compare-and-set followed by successor insertion rather than one
  provider transaction. Local/preview auth storage also shares the Vercel-linked Neon database;
  preview is Vercel-protected and only the allowlisted owner can grant. Re-evaluate all three when
  a stable provider fix or environment-isolated auth store is adopted.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Refresh tokens die after ~7 days** | The Google OAuth app is in *Testing* status. Publish it to **In production** (Audience page). Testing caps refresh tokens at 7 days (`refresh_token_expires_in: 604799`). |
| **"Google hasn't verified this app" warning** | Expected for this private, unverified, in-production app. Emmett may proceed (Advanced → continue). **Do not** submit for verification; see ADR-0001/ADR-0002. |
| **Redirect URI mismatch / new domain 404s** | Every domain that serves the app needs its two redirect URIs registered on the OAuth client. Redirect changes and DNS/CNAME can take minutes to propagate. |
| **`reauth_required` on the dashboard or in tool errors** | The health refresh token failed or expired (often the 7-day Testing cap). Re-run the Google Health consent flow (Connect/Reconnect). |
| **Data looks stale / a workout is missing** | The device path is not live: Fitbit Air → Fitbit app → Google Health has real sync latency. `freshness.isPossiblyStale` + `latestDataTime` flag this; missing data ≠ zero activity. |
| **MCP endpoint returns 401** | No/invalid OAuth token. The `WWW-Authenticate` header points at the protected-resource metadata; the client should walk the OAuth flow. |
| **Hermes, Claude Code, or Codex reconnects every hour** | The loopback callback may have succeeded while an older registration requested only the two health scopes, which cannot receive a refresh token. Re-authenticate the one affected connector once on 0.3.0 or newer; do not disconnect Google Health or rotate shared secrets. |
| **New env var isn't taking effect** | Production env changes apply on the **next deploy**. Redeploy. |
| **Build fails on TypeScript** | Keep `typescript` pinned to `^5`. Next 16's build-time type checker cannot load the TS 7 native compiler. |
| **No deploy after `git push`** | The auto-deploy webhook has occasionally not fired; deploy manually via the Vercel CLI. |
| **Non-allowlisted Google account can't sign in** | Working as intended — sign-in is rejected server-side for any email not in `ALLOWED_GOOGLE_EMAILS` (fails closed on an empty allowlist). |
| **Claude returns from the browser immediately, then the connector fails** | An existing Google session can make Google sign-in silent, so the missing account-chooser page is not itself an error. Use the [work-computer OAuth runbook](#claude-work-computer-oauth-browser-returns-connector-still-fails) to locate the stage that failed. |

### Claude work-computer OAuth: browser returns, connector still fails

This is the **MCP client-auth** flow, not Google Health consent. If the browser already has a
valid Google session, clicking **Sign in with Google** can complete without showing Google's
account chooser. The saved MCP authorization request then resumes and returns to Claude
immediately. That silent SSO path is normal; the useful question is what happened *after* the
return.

Anthropic's [remote-connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
explains that remote connectors are configured and brokered through the Claude account, with
the MCP connection originating from Anthropic's servers rather than the workstation. They can
be shared across Claude on the web, Desktop, and Claude Code when the same account and
workspace are selected; see Anthropic's
[connector guidance](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).
On Team and Enterprise plans, an Owner or Primary Owner must add/enable the connector for the
organization, and each user normally authenticates it individually.

Record the last confirmed stage before changing anything:

| Last confirmed stage | What it means |
|---|---|
| The Health MCP sign-in page never opens | Check Claude's connector URL, selected account/workspace, and organization connector configuration. |
| The sign-in page opens; no Google chooser appears; the browser returns to Claude | This can be normal silent Google SSO. Continue tracing the callback/token stages. |
| Google or the Health MCP shows an error before returning | Investigate Google sign-in, the email allowlist, redirect URI, or server-side authorization error. |
| Claude receives the callback, but the server records no access-token issuance | Investigate the callback handoff and token exchange. |
| The server issues an access token, but no authenticated `/api/mcp` request follows | On versions before 0.1.2, the client may have rejected the malformed legacy ID token after access-token persistence. On 0.1.2+, first confirm JWKS/ID-token verification, then investigate Claude's connector state, credential persistence, workspace, or duplicate configuration. |
| An authenticated MCP initialize or tool request reaches `/api/mcp` | OAuth succeeded; troubleshoot MCP transport, reconnection, or the tool call separately. |

For the work-computer incident that prompted this runbook, production evidence showed Claude
access tokens being persisted after the browser returned. A regression replay then found that
better-auth's deprecated MCP path issued an ephemeral `HS256` ID token while advertising
`RS256`, omitted the issuer, wrote `auth_time` in milliseconds, and advertised JWKS/UserInfo
endpoints that returned 404. A strict client can reject that response before its first Bearer
request even though the server has already stored the access token. Version 0.1.2 repairs that
boundary with an encrypted, persisted `RS256` signing key and live JWKS/UserInfo endpoints;
the work-computer retry remains the final acceptance check. This is MCP client auth, not evidence
that Google Health consent failed.

That paragraph describes the **pre-0.3.0 legacy bridge** retained only as rollback data. New
connections use the maintained OAuth Provider, persisted RS256 JWKS, exact `/api/mcp` audience,
and locally verified JWT bearer requests.

A fresh 2026-07-14 revalidation also completed native DCR, S256 PKCE, browser handoff, loopback
callback, token exchange, MCP initialize/discovery, and a read-only tool call through **both**
Claude Code and Codex against production. Claude used a `localhost` callback; Codex used its
`127.0.0.1:<ephemeral>/callback/<server-id>` shape. The account-level Claude connector and the
separately authenticated direct Claude Code entry were both connected, and the correlated server
window contained no relevant OAuth/MCP 5xx or unexpected 4xx responses. A new failure that occurs
before any server request is therefore on the client, work-network, or workspace-policy side, not
an MCP callback failure demonstrated at the Health server.

Do **not** rotate shared auth/encryption secrets, revoke unrelated users' or clients' tokens,
disconnect Google Health, or clear every credential as a first response. Scope any reset to the
one affected connector.

Recovery sequence:

1. Capture the exact Claude error (including any `ofid_...` identifier), local timestamp with
   timezone, Claude Code or Desktop version, selected Claude account/workspace, and whether the
   connector came from Claude's account settings or a direct Claude Code MCP entry.
2. Update Claude Code/Desktop, fully quit the affected clients (including the Desktop tray
   process), reopen them, and confirm the same account and workspace are selected.
   Use the latest available release; see Anthropic's
   [Claude Code changelog](https://code.claude.com/docs/en/changelog).
3. Check the account-level connector in Claude's connector settings. On Team/Enterprise, have
   an Owner or Primary Owner confirm its organization configuration. Disconnect/reconnect the
   affected user, or remove and re-add that remote connector **once**; avoid repeated retries
   that create more client registrations without isolating the failing stage. Re-add it only at
   `https://health.emmetts.dev/api/mcp`, authenticate once, and test it on Claude web before
   checking Desktop and Code.
4. In Claude Code, check `claude mcp list` and `/mcp` for a separately configured direct entry
   pointing to the same URL. Direct local/project/user entries take precedence over a duplicate
   claude.ai connector. For that duplicate direct entry only, use **Clear authentication** in
   `/mcp`, remove the duplicate, and retry with the account connector (or re-add the direct entry
   once if it is intentionally preferred). Anthropic documents this precedence and the clear-auth
   control in the [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).
5. Use Claude Code's “paste the full callback URL” fallback only when the browser ends on a
   literal connection error at a local `http://localhost:<port>/callback` URL and Claude Code is
   prompting for that URL. It does not apply to a normal remote return to Claude Desktop or to a
   callback that already completed.
6. If the failure persists on 0.1.2 after the ID token verifies against the advertised JWKS,
   preserve the captured `ofid_...`, timestamp, versions, workspace type, and sanitized `/mcp`
   status for Anthropic support, together with the server-side timeline. A valid token response
   followed by no authenticated MCP request is then a post-token client/connector failure.

For Codex, `codex mcp list` should show the Health entry as `OAuth`; use
`codex mcp login shaughv-health` for a connector-scoped retry. Codex registers a public client and
owns a randomized `127.0.0.1` callback, so no fixed Codex callback belongs in Google Cloud. If a
Codex run fails before the server receives DCR or an unauthenticated MCP discovery probe, update
Codex and correct the local model/client configuration first. See OpenAI's
[Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Hermes Desktop, direct Claude Code, and Codex use different local callback shapes, all supported by
this server: Hermes uses an ephemeral `127.0.0.1:<port>/callback`, Claude Code normally uses its
fixed `localhost` callback port, and Codex uses an ephemeral `127.0.0.1` path that can include a
server-specific callback identifier. Native IP-literal loopback redirects accept the actual
listening port selected at authorization time; the protocol, host, path, and query remain exact.

The protected-resource document and initial 401 intentionally do not narrow the OAuth request to
resource scopes. Current desktop clients differ in how they prioritize challenge, resource, and
authorization-server metadata; narrowing them to `health:read health:write` can complete the
browser callback but omit `offline_access`, producing no refresh token. Clients now fall back to
the authorization server's complete six-scope contract. A real write-scope failure still returns
an explicit `health:write` step-up challenge. Existing public registrations are expanded
additively, but an already issued one-hour access token does not become refreshable: reauthenticate
that connector once to receive a rotating refresh credential.

## Task board

Work is tracked on a self-contained board under **`.tasks/`** (the SHAUGHV tasks system).

- **`.tasks/TASKS.md`** — the board (Backlog / To-Do / Active / Done). Source of truth for
  what's next.
- **`.tasks/MILESTONES.md`** — dated epics; tasks join one with an `(ms #id)` tag. Current
  milestone: **`#mcp2`** (1.0.0 stable release and remaining qualification).
- **`.tasks/tasks/<id>.md`** — a rich detail file per task (TT;DR-led, with `## Verification`,
  `## Status`, `## Activity`). The decision history lives here — e.g. `rlw.md` (Railway/FastMCP),
  `api.md` (REST surface feasibility), `inf.md` (the infra session), `w11.md` (webhooks v1.1).
- **`.tasks/CLAUDE.md`** — working memory (people, terms, projects, preferences).

The live dashboard is a zero-dependency Node server; resolve its port from
`.tasks/.board-server.json` or run `node .tasks/board-server.mjs status`. See
[`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) for how agents should use the board.

## Further reading

- **`docs/adr/0001-private-allowlist-only.md`** — accepted private-audience, OAuth
  verification, and access-control decision.
- **`docs/PLAN.md`** — the authoritative build plan (read first).
- **`docs/adr/0003-vercel-node-fluid-mcp-2026.md`** — current host/runtime decision.
- **`docs/research/2026-07-29-mcp-sdk-v2-and-hosting.md`** — SDK v2, auth, hosting,
  compatibility, and pricing research.
- **`CLAUDE.md`** — instructions for Claude coding sessions.
- **`AGENTS.md`** — the same operational guidance, tool-neutral, for any agent (Codex,
  Cursor, etc.).
- **`.env.example`** — the env-var reference.
