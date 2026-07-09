# Glossary

## Acronyms & abbreviations

- **MCP** — Model Context Protocol. This repo is a remote MCP *server*; LLM clients (Claude, ChatGPT) are the callers.
- **DCR** — Dynamic Client Registration (RFC 7591). claude.ai and ChatGPT connectors self-register as OAuth clients; better-auth provides the `/register` endpoint.
- **AS / RS** — OAuth Authorization Server / Resource Server. This app is BOTH: better-auth is the AS, the MCP endpoint is the RS (`/.well-known/oauth-protected-resource` links them).
- **AZM** — Active Zone Minutes (Fitbit/Google Health activity metric).
- **HR / HRV** — Heart Rate / Heart Rate Variability.
- **TT;DR** — "Too Tired; Didn't Read" — plain-English 1–2 sentence lead on task detail files.

## Project terms

- **Google Health API** — Fitbit Web API successor. REST base `https://health.googleapis.com/v4`. Data types kebab-case in paths (`body-fat`), snake_case in filters (`body_fat`) — central registry only, never ad-hoc conversion.
- **civil time vs physical time** — Google Health stores UTC + UTC offset; `dailyRollUp` takes civil ranges (non-zero-padded ints!), `rollUp` takes physical UTC ranges.
- **true zeros / on-wrist filtering** — explicit 0 = worn-but-inactive; missing data = off-wrist or unsynced. Never phrase gaps as inactivity.
- **freshness ledger** — `data_freshness` table storing latest webhook notification per (user, dataType). Webhook payloads have NO values, only `{dataType, operation, intervals}` pointers.
- **single-flight refresh** — token refresh guarded by `SELECT ... FOR UPDATE` so concurrent tool calls don't double-refresh.
- **7-day token rule** — Google OAuth apps in "Testing" status expire refresh tokens after 7 days; Emmett publishes the app to "In production" (unverified) in Phase 7 to fix this.

## Naming

- Repo: `Google-Health-MCP` (GitHub) · project/package: `shaughv-health-mcp` · DB: `shaughv-health-db` (Neon).
