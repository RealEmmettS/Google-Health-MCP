# shaughv-health-mcp

A **private, single-user remote MCP server** on Vercel that lets Emmett's trusted LLM
assistants — Claude Code / Claude Desktop, claude.ai (web + mobile connectors), and
ChatGPT connectors — **read** his Google Health / Fitbit Air data ("How many steps today?",
"How did I sleep?", "Why am I tired?", "What did I eat yesterday?") and **write** the things
a Fitbit Air can't track itself: nutrition, hydration, and body measurements.

It is a **thin, typed, authenticated data adapter** over the
[Google Health API](https://developers.google.com/health) (`health.googleapis.com/v4`).
The LLM does the reasoning; this server returns accurate data with timestamps, units, and
**freshness metadata** on every response. It is **not** a health warehouse, an analytics
product, or anything that diagnoses — there are no medical claims anywhere in the surface.

> **`docs/PLAN.md` is the build plan and the source of truth** for architecture, the four
> auth layers, the database schema, the tool surface, the watchouts, and the E2E
> verification bar. This README is the human front door; the plan governs the build.
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
| Private and single-user (Emmett only, allowlisted) | Multi-tenant or public |
| A returner of data + freshness metadata + units | A source of diagnoses, advice, or medical claims |

The device data path is **never live** — a Fitbit Air syncs to the Fitbit app, which
pushes to the Google Health cloud, which this server reads on demand. Every response
therefore carries `freshness` metadata (`retrievedAt`, `latestDataTime?`, `isPossiblyStale`,
`note`) so the LLM can distinguish "no data synced yet" from "nothing happened."

## Who it's for and how it's used

**Audience:** Emmett, and the LLM assistants he authorizes. Nobody else can sign in
(sign-in is locked to `ALLOWED_GOOGLE_EMAILS`).

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

**Future directions** (parked on the board, not part of v1 — see [Task board](#task-board)):
- **`#api`** — a plain REST API surface (bearer/PAT-authenticated) over the same health
  services, so Emmett's own scripts/apps can call the data without an OAuth dance.
  Feasibility analyzed: feasible and additive on the current stack.
- **`#rlw`** — a possible future migration from Vercel serverless to **Railway** (long-lived
  container); this is the moment the FastMCP question reopens.
- **`#w11`** — **v1.1 webhooks**: learn when new data lands (subscriber registration,
  signature verification, a freshness ledger). Deferred by design; tables already exist but
  stay dormant in v1.

## Architecture

```
                    ┌─────────────┐   Bluetooth sync   ┌──────────────┐
   Fitbit Air ─────▶│  Fitbit app  │ ─────────────────▶│ Google Health │
   (wearable)       │  (phone)     │                    │    cloud     │
                    └─────────────┘                     └──────┬───────┘
                                                               │  Google Health API
                                                               │  health.googleapis.com/v4
                                                               │  ▲ user OAuth token
                                                               │  │  (AES-256-GCM
                                                               │  │   encrypted in Neon)
                                                               ▼  │
   ┌───────────────────────────┐   OAuth 2.1 + DCR    ┌────────┴──────────────────────┐
   │  LLM client               │ ───────────────────▶ │  Next.js on Vercel            │
   │  Claude Code / Desktop    │                       │  (health.emmetts.dev)         │
   │  claude.ai web + mobile   │ ◀─────────────────── │                               │
   │  ChatGPT connector        │   MCP tools/resources │  ┌─────────────────────────┐  │
   └───────────────────────────┘                       │  │ mcp-handler  → /api/mcp │  │
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

**Request path in one line:** an LLM client completes an OAuth 2.1 flow (with Dynamic Client
Registration) against *this app's own* authorization server, gets a token, calls the MCP
endpoint; a tool handler resolves the app user, fetches fresh data from Google Health using
the decrypted-on-demand health token, bounds/normalizes the payload, and returns it with
freshness metadata.

### The four auth layers (never conflate)

These are four **separate** things. Confusing them is the number-one source of bugs here.

| # | Layer | What it is | Status |
|---|---|---|---|
| 1 | **Vercel account login** | Emmett's Vercel dashboard access | Irrelevant to runtime |
| 2 | **Neon Auth** | Neon's own auth product | **Disabled** — Neon is only a database |
| 3 | **Google Health consent** | Health-scope OAuth; tokens **AES-256-GCM encrypted** in Neon; done once per (re)connect | Custom routes under `/api/auth/google-health/*` |
| 4 | **MCP client auth** | This app **is** an OAuth 2.1 authorization server (better-auth built-in `mcp` plugin, DCR on); the human login step is Google Sign-In restricted to `ALLOWED_GOOGLE_EMAILS` | Endpoints under `/api/auth/mcp/*` + `/.well-known/*` |

Layers 3 and 4 use the **same** Google OAuth client ID but separate flows and scopes. Layer
4's login uses basic `openid email profile` scopes only; layer 3 requests the nine
`googlehealth.*` scopes. The health-flow refresh token is the one that gates data access.

## Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router) | Server-centric; all API routes on the **Node runtime** (never edge — needs `node:crypto` + the DB driver) |
| Language | **TypeScript 5.9** | Pinned to `^5`: Next 16's build-time type checker cannot load the TS 7 native compiler (see [Troubleshooting](#troubleshooting)) |
| MCP transport | **`mcp-handler`** + `@modelcontextprotocol/sdk` | Streamable HTTP, per-request. Deliberately **not FastMCP** (a decision — see [`CLAUDE.md`](CLAUDE.md) / `.tasks/tasks/rlw.md`) |
| Auth server | **better-auth 1.6.23**, built-in `mcp` plugin | The built-in `better-auth/plugins` `mcp`, **not** `@better-auth/mcp` (that package targets the unreleased 1.7) |
| Database | **Neon Postgres** + **Drizzle ORM** (`@neondatabase/serverless`) | **Pooled** URL at runtime, **unpooled** URL for migrations |
| Time | **Luxon** | Timezone-correct ranges (default `America/Chicago`), DST-safe, sleep-crosses-midnight logic |
| Validation | **Zod 4** | Tool input schemas; write-tool validation |
| Tests | **Vitest** (+ MSW / undici mocks) | Unit + mocked-API integration |
| Host | **Vercel** | Canonical domain **`health.emmetts.dev`**; Deployment Protection is preview-only (production must stay open — the app brings its own auth) |

## Current status

Milestone **`#v1`** (target 2026-07-16). The `.tasks/` board is the live source of phase
status; this section is a coarse snapshot that intentionally avoids fast-moving detail.

- **Done and verified on prod:** repo bootstrap, operator infrastructure (Vercel project
  live on `health.emmetts.dev`, Neon connected, Google OAuth client wired with all six
  redirect URIs, app published to production), the database + security foundation
  (encryption, redaction, audit, all 15 tables migrated), and **MCP client auth** (better-auth
  OAuth 2.1 + DCR, Google sign-in locked to the allowlist — live sign-in confirmed on prod).
- **Landed / wrapping up:** the **Google Health consent + token lifecycle** flow (health-scope
  consent, encrypted token store, identity mapping, single-flight refresh) — deployed to prod,
  awaiting Emmett's one-time health-consent click test — and the **typed Google Health API
  client** (data-type registry, request methods, error normalization, Luxon time utils).
- **Pending:** the MCP endpoint + read tools + resources (Phase 5), write tools + audit
  (Phase 6), and the deploy/wire-clients E2E acceptance run (Phase 7).
- **Check the board for exact state** — phases are moving daily; `.tasks/TASKS.md` is
  authoritative.
- **Deferred by design:** Google Health webhooks (**v1.1**, `#w11`).

> The MCP endpoint (`/api/mcp`) is **not live yet** — it lands in Phase 5. The client
> connection commands below are the intended interface once that phase and Phase 7 ship.

## Repository structure

```
.
├── docs/PLAN.md                    ← SOURCE OF TRUTH (architecture, decisions, phases, E2E bar)
├── README.md                       ← this file (human front door)
├── CLAUDE.md                       ← agent instructions for Claude sessions
├── AGENTS.md                       ← agent instructions, tool-neutral (Codex/Cursor/etc.)
├── .env.example                    ← every env var, documented by name
├── package.json                    ← scripts + pinned deps
├── next.config.ts / tsconfig.json / drizzle.config.ts / vitest.config.ts
│
├── app/                            ← Next.js App Router
│   ├── layout.tsx · page.tsx       ← landing / status dashboard
│   ├── sign-in/page.tsx            ← Google sign-in (resumes interrupted OAuth flows)
│   ├── components/sign-out-button.tsx
│   ├── api/
│   │   ├── auth/[...all]/route.ts           ← better-auth handler (sign-in, /mcp/authorize, /token, DCR /register)
│   │   ├── auth/google-health/start/route.ts    ← health-consent redirect (session-gated)
│   │   ├── auth/google-health/callback/route.ts ← code exchange → encrypt+store → identity map
│   │   └── health/status/route.ts          ← healthcheck (no secrets)
│   └── .well-known/
│       ├── oauth-authorization-server/route.ts
│       └── oauth-protected-resource/route.ts
│   #   app/api/[transport]/route.ts          ← MCP endpoint /api/mcp — ARRIVES in Phase 5
│
├── src/
│   ├── auth/           ← auth.ts (better-auth config), allowlist, app-user resolution,
│   │                     state (health-consent CSRF state), token-service (single-flight
│   │                     refresh), token-store, google-health-oauth, auth-client
│   ├── db/             ← schema.ts (8 domain tables), auth-schema.ts (7 better-auth tables), client.ts
│   ├── security/       ← encryption.ts (AES-256-GCM), redact.ts
│   ├── audit/          ← mutation-audit.ts (insert-only audit writer)
│   └── google-health/  ← registry.ts (data-type single source of truth), scopes.ts, errors.ts
│   #   src/google-health/client.ts + src/time/  ← land in Phase 4
│   #   src/health-services/                       ← shared service layer, Phase 5 (also enables #api)
│
├── drizzle/            ← generated SQL migrations + meta
├── scripts/db-inspect.mjs   ← utility: list/inspect Neon tables
├── tests/unit/         ← Vitest: encryption, redact, allowlist, state, token-service, google-health-oauth
└── .tasks/             ← the task board (see "Task board")
```

Database tables (15 total): domain — `app_users`, `oauth_connections`, `oauth_tokens`,
`oauth_states`, `mutation_audit_log`, `webhook_events` (dormant), `data_freshness` (dormant),
`health_cache`; better-auth — `user`, `session`, `account`, `verification`,
`oauthApplication`, `oauthAccessToken`, `oauthConsent`.

## Setup guide

### 1. Accounts and services

1. **Google Cloud** — enable the Google Health API; configure the OAuth consent screen with
   the `googlehealth.*` scopes; create an OAuth **web** client; add the redirect URIs below;
   **publish the app to "In production"**. Publishing is essential: in *Testing* status
   Google expires refresh tokens after **7 days** (`refresh_token_expires_in: 604799`). The
   "unverified app" badge that appears after publishing is expected and stays — **do not**
   submit for verification.
2. **Vercel** — import this repo as a project. Framework auto-detects as Next.js. Keep
   **Deployment Protection = preview-only** (production must stay open so programmatic MCP
   clients can reach it; the app enforces its own auth).
3. **Neon** — a Postgres database provisioned via the Vercel Marketplace and connected to the
   project in the Storage tab. The integration injects `DATABASE_URL` (pooled) and
   `DATABASE_URL_UNPOOLED` automatically.

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
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 AES-256-GCM key | **Different value local vs prod.** Losing it orphans all stored tokens (reconnect required) |
| `BETTER_AUTH_SECRET` | better-auth signing secret | |
| `BETTER_AUTH_URL` | Auth issuer / base URL | `http://localhost:3000` local · `https://health.emmetts.dev` prod |
| `NEXT_PUBLIC_APP_URL` | Public app URL | Matches `BETTER_AUTH_URL` per environment |
| `ALLOWED_GOOGLE_EMAILS` | Comma-separated allowlist | The Google account(s) that own the Fitbit/Google Health data; the sign-in perimeter |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | v1.1 webhooks | Leave empty until v1.1 |
| `GOOGLE_HEALTH_SUBSCRIBER_ID` | v1.1 webhooks | Leave empty until v1.1 |
| `WEBHOOK_AUTH_SECRET` | v1.1 webhooks | Leave empty until v1.1 |

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

## Connecting an MCP client

> Available once the MCP endpoint ships (Phase 5) and prod is wired (Phase 7). Each client
> walks the OAuth flow and you sign in with the allowlisted Google account.

- **Claude Code:**
  `claude mcp add --transport http health https://health.emmetts.dev/api/mcp`
- **claude.ai (web + mobile):** Settings → Connectors → Add custom connector →
  `https://health.emmetts.dev/api/mcp` → complete OAuth.
- **ChatGPT:** Add a custom connector — it registers itself via Dynamic Client Registration.

## MCP surface

Defined in `docs/PLAN.md` §"MCP surface (v1)"; input schemas per the handoff spec §11. Every
read response carries `freshness` + units and is payload-bounded (default pageSize ≤ 100; HR
series summarized via rollups; truncation notes when capped).

**Read tools (9, + `ping`):** `get_today_steps`, `get_sleep_summary`, `get_latest_heart_rate`,
`get_exercise_week`, `get_nutrition_log`, `get_health_context` (bundle: sleep + latest HR +
resting HR/HRV + recent activity + nutrition — data only, no conclusions), `query_health_data`
(generic list/reconcile, registry-allowlisted), `rollup_health_data`, `get_sync_status`.

Notable behaviors: `query_health_data` auto-builds the right filter per record type — including
the civil `date` field for `daily-*` aggregates, which carry no physical timestamp (a
sample-time filter would silently return everything); use `mode: "reconcile"` for Google's
merged/deduped stream when multiple sources log the same metric. `get_sleep_summary`
distinguishes `STAGES` (deep/light/REM) from `CLASSIC` sessions (a single asleep block — a
device capture condition, surfaced via `stagesStatus`, e.g. `REJECTED_COVERAGE`, not poor
sleep). Staleness is cadence-aware: once-per-night metrics (sleep, `daily-*`) don't flag
`isPossiblyStale` for a same-day value; live-ish samples use a 3-hour threshold.

**Write tools (5):** `create_nutrition_log`, `update_nutrition_log` (replace semantics — the
live PATCH endpoint 500s; a new data-point name is returned), `delete_nutrition_log`,
`create_hydration_log`, `update_measurement` (weight | body-fat | height). `update_profile`
was **dropped**: the live endpoint 403s despite the granted scope (documented server-side
bug); the service layer is kept for re-enablement.

**Resources (5):** `health://profile`, `health://settings`, `health://connected-user`,
`health://data-types`, `health://freshness`.

**Absent by design:** sleep, exercise, and settings **writes**; bulk historical writes.

## Security posture

- **Four auth layers, never conflated** (table above). The MCP endpoint requires a valid
  OAuth token; sign-in is allowlisted to `ALLOWED_GOOGLE_EMAILS`; DCR is open by design
  (any client may *register* — safety comes from the allowlisted *login*, not registration).
- **Google tokens are AES-256-GCM encrypted at rest** (`TOKEN_ENCRYPTION_KEY`, with
  `key_version` for rotation). No plaintext tokens in the DB, logs, or error paths — a
  `redact()` helper strips token patterns (`ya29.`, `1//`, `GOCSPX-`, JWTs, `Bearer`/`Basic`,
  Neon `npg_`) before anything is logged.
- **Token refresh is single-flight** (`SELECT … FOR UPDATE` on the token row) to avoid
  concurrent-refresh races; on refresh failure the connection is marked `reauth_required`.
- **Writes** (nutrition / hydration / measurements only) are Zod-validated, explicit-input
  only, and every mutation is audit-logged in `mutation_audit_log`. There are **no** sleep /
  exercise / settings write tools at all.
- **No medical diagnosis language** anywhere; freshness/limitation notes on every response.
- Production stays open (no Vercel SSO wall) on purpose — the application's own auth is the
  perimeter.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Refresh tokens die after ~7 days** | The Google OAuth app is in *Testing* status. Publish it to **In production** (Audience page). Testing caps refresh tokens at 7 days (`refresh_token_expires_in: 604799`). |
| **"Google hasn't verified this app" warning** | Expected for an unverified, in-production app. Proceed (Advanced → continue). **Do not** submit for verification. |
| **Redirect URI mismatch / new domain 404s** | Every domain that serves the app needs its two redirect URIs registered on the OAuth client. Redirect changes and DNS/CNAME can take minutes to propagate. |
| **`reauth_required` on the dashboard or in tool errors** | The health refresh token failed or expired (often the 7-day Testing cap). Re-run the Google Health consent flow (Connect/Reconnect). |
| **Data looks stale / a workout is missing** | The device path is not live: Fitbit Air → Fitbit app → Google Health has real sync latency. `freshness.isPossiblyStale` + `latestDataTime` flag this; missing data ≠ zero activity. |
| **MCP endpoint returns 401** | No/invalid OAuth token. The `WWW-Authenticate` header points at the protected-resource metadata; the client should walk the OAuth flow. |
| **New env var isn't taking effect** | Production env changes apply on the **next deploy**. Redeploy. |
| **Build fails on TypeScript** | Keep `typescript` pinned to `^5`. Next 16's build-time type checker cannot load the TS 7 native compiler. |
| **No deploy after `git push`** | The auto-deploy webhook has occasionally not fired; deploy manually via the Vercel CLI. |
| **Non-allowlisted Google account can't sign in** | Working as intended — sign-in is rejected server-side for any email not in `ALLOWED_GOOGLE_EMAILS` (fails closed on an empty allowlist). |

## Task board

Work is tracked on a self-contained board under **`.tasks/`** (the SHAUGHV tasks system).

- **`.tasks/TASKS.md`** — the board (Backlog / To-Do / Active / Done). Source of truth for
  what's next.
- **`.tasks/MILESTONES.md`** — dated epics; tasks join one with an `(ms #id)` tag. Current
  milestone: **`#v1`**.
- **`.tasks/tasks/<id>.md`** — a rich detail file per task (TT;DR-led, with `## Verification`,
  `## Status`, `## Activity`). The decision history lives here — e.g. `rlw.md` (Railway/FastMCP),
  `api.md` (REST surface feasibility), `inf.md` (the infra session), `w11.md` (webhooks v1.1).
- **`.tasks/CLAUDE.md`** — working memory (people, terms, projects, preferences).

The live dashboard is a zero-dependency Node server; resolve its port from
`.tasks/.board-server.json` or run `node .tasks/board-server.mjs status`. See
[`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) for how agents should use the board.

## Further reading

- **`docs/PLAN.md`** — the authoritative build plan (read first).
- **`CLAUDE.md`** — instructions for Claude coding sessions.
- **`AGENTS.md`** — the same operational guidance, tool-neutral, for any agent (Codex,
  Cursor, etc.).
- **`.env.example`** — the env-var reference.
</content>
</invoke>
