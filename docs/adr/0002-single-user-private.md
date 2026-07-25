# ADR-0002: Operate the Google Health MCP for Emmett only

- **Status:** Accepted
- **Date:** 2026-07-25
- **Decision owner:** Emmett Shaughnessy
- **Supersedes:** ADR-0001's two-person audience and offboarding behavior

## Context

ADR-0001 established a private, allowlist-only service for Emmett and Christian. Christian
did not use the service. Emmett explicitly removed that approval on 2026-07-25 and authorized
complete offboarding. A read-only production database inventory found no Christian Better
Auth user, browser session, MCP token/consent, Google Health connection, encrypted token,
cache, freshness, update, audit, or webhook row. No production health data therefore needed
destructive deletion.

The v1.1 release also adds a short-lived encrypted exact-response cache, pointer-only Google
Health webhooks, a freshness ledger, and visible privacy controls. Those features make the
retention and immediate-revocation boundary worth stating explicitly.

## Decision

The service remains private, external, in production, and intentionally unverified, but its
approved human audience is now **Emmett only**:

| Person | Approved Google identity | Notes |
|---|---|---|
| Emmett Shaughnessy | `eshaughv@gmail.com` | Google/Fitbit account |
| Emmett Shaughnessy | `google@emmetts.dev` | Native alias of the same approved account |

Both identities represent one person. No other email is approved. Adding another person,
opening signup, using the unverified 100-user allowance as a distribution plan, submitting
for restricted-scope verification, or starting CASA requires a new superseding ADR approved
by Emmett.

`ALLOWED_GOOGLE_EMAILS` remains fail-closed. The MCP transport now rechecks the current
allowlist on every bearer request, in addition to Better Auth's user/session creation hooks.
Removing an identity therefore blocks existing MCP bearer use immediately; operator cleanup
must still delete that identity's sessions, MCP grants, and Google Health connection.

## Stored data and control

- Google OAuth tokens and exact Google Health API response-cache payloads are AES-256-GCM
  encrypted at rest. Cache AAD binds every payload to its app user and exact operation key.
- Current-data cache TTLs are measured in minutes; closed historical ranges may live for up
  to 30 minutes. Expired cache rows are never served and are physically removed by daily
  retention maintenance.
- Webhooks contain pointers only (`healthUserId`, data type, operation, intervals), not health
  values. Update pointers expire after seven days; webhook delivery records after 30 days.
  Per-data-type freshness metadata persists until disconnection/deletion.
- The public `/privacy` page discloses storage, use, retention, LLM-client sharing, and user
  controls.
- An authenticated same-origin action can disconnect Google Health, best-effort revoke the
  Google grant, and remove connection-derived local rows.
- A separately confirmed authenticated action can permanently delete every locally stored
  Google Health domain row, including explicit-write audit records. Neither action deletes
  data held independently by Google, Fitbit, or an MCP client.

## Consequences

The deployment has one operator and one human data subject, represented by two approved
Google identities. User-scoped schema and isolation remain because they are security
boundaries, not an invitation to broaden the audience. DCR remains public only for connector
compatibility; authorization still requires Emmett's allowlisted login.

ADR-0001 remains useful historical reasoning for the private/unverified posture, quota
assessment, and public-access alternatives. Where it names Christian as approved or says
allowlist removal does not affect existing MCP bearer requests, this ADR governs instead.
