# ADR-0001: Keep the Google Health MCP private and allowlist-only

- **Status:** Accepted
- **Date:** 2026-07-10
- **Decision owner:** Emmett Shaughnessy
- **Scope:** Runtime audience, Google OAuth publication/verification posture, and access-control operations
- **Supersedes:** Earlier wording that described Emmett as the sole user; the service is private but supports the two explicitly approved people below

## Context

`shaughv-health-mcp` is a remote MCP server at `health.emmetts.dev`. It lets approved
people connect their own Google Health account to trusted MCP clients, read activity,
sleep, heart, nutrition, profile, settings, and device data, and write explicit nutrition,
hydration, and body-measurement entries. It is a thin authenticated adapter: the MCP client
does the reasoning, while the server returns bounded data with timestamps, units, and
freshness metadata. It is not a public health application, a warehouse, or a diagnostic
system.

The original v1 plan described the product as single-user. The implemented schema and
request path are actually user-scoped, and Christian was subsequently added to the private
allowlist. This ADR resolves that wording mismatch: the product is **private and
allowlist-only**, with two approved people, rather than literally single-user or generally
multi-tenant.

On 2026-07-10, public access was evaluated against the implemented code, the live Google
Cloud project, and Google's current documentation. The findings were:

- Google Health data scopes are restricted scopes. An unverified app is limited to 100
  lifetime users and presents an unverified-app warning. A genuinely public app must
  complete OAuth verification and a recurring Cloud Application Security Assessment
  (CASA).
- Google's Google Health verification guide estimates third-party assessment fees of
  **USD $500-$4,500**, with reassessment required annually. Google determines the
  assessment tier from scope sensitivity, user count, and other risk signals; a free Tier 2
  path may exist but is not guaranteed.
- Public verification would also require public privacy and terms pages, in-product health
  data disclosures, affirmative consent, documented data deletion, scope-by-scope
  justifications, a demonstration video, security remediation, and ongoing compliance.
- Google Health request capacity is not the blocker. Live quota readback matched the
  documented defaults: 86.4 million requests/day/project, 120,000 requests/minute/project,
  and 300 requests/minute/user. The project recorded 229 requests in the preceding 30-day
  monitoring window.
- No Google Health API billing service or SKU appeared in the live Cloud Billing catalog as
  of the decision date. Google Health calls therefore had no identified per-request cost;
  this is a point-in-time observation, not a promise that Google will never add pricing.

The verification burden, recurring assessment, public-product compliance surface, and lack
of a product need for arbitrary users outweigh the benefit of opening access.

## Decision

### Audience

The deployed MCP remains private. Only these people and Google identities are approved:

| Person | Approved Google identity | Notes |
|---|---|---|
| Emmett Shaughnessy | `eshaughv@gmail.com` | Google/Fitbit account |
| Emmett Shaughnessy | `google@emmetts.dev` | Native alias of the same approved account |
| Christian Adleta | `[redacted]` | Christian's approved Google account |

No public signup, first-100-user beta, arbitrary Google-account access, or self-service
onboarding will be offered. Editing an environment variable is not sufficient authority to
expand this list. Any additional person requires Emmett's explicit decision and an amendment
or superseding ADR.

Each approved person connects and accesses **their own** Google Health data. Approval never
grants one person access to another person's connection, tokens, cache entries, audit rows,
or health data.

### Google OAuth posture

- The Google OAuth audience remains **External** because the approved identities are not an
  internal Google Workspace population.
- The app remains **In production** so Google Health refresh tokens are not subject to the
  seven-day Testing-mode lifetime.
- The app intentionally remains **unverified**. Do not submit it for public OAuth
  verification or begin CASA unless this ADR is superseded.
- The unverified-app warning is an accepted consequence for the two approved users.
- The 100-user unverified cap is not a capacity target. It is deliberately left unused.

### Runtime access boundary

`ALLOWED_GOOGLE_EMAILS` remains a required, comma-separated, fail-closed environment
variable in every runtime environment. Its values must match the approved identities above.
There is no wildcard, domain-wide, empty-means-public, or development bypass.

Dynamic Client Registration remains enabled because claude.ai and ChatGPT connectors need
it. OAuth metadata and client-registration endpoints are therefore publicly reachable by
design. Public registration does **not** grant data access: an MCP client can receive a
usable authorization only after an approved person completes Google Sign-In.

## Current implementation

This section records the implementation that exists when the decision was accepted. It is a
map for maintainers, not permission to weaken any invariant.

### Four separate auth layers

| Layer | Current role | Access effect |
|---|---|---|
| Vercel account access | Deployment/operator control | Not runtime end-user authentication |
| Neon Auth | Disabled | Neon is only the Postgres database |
| Google Health consent | Custom `/api/auth/google-health/*` flow requesting health scopes | Gives one approved app user access to that same person's Google Health account |
| MCP client auth | better-auth OAuth 2.1 authorization server with DCR | Issues MCP access to the authenticated, allowlisted better-auth user |

The Neon database was provisioned and connected from the Vercel dashboard through its
Storage/Marketplace integration; it is not a separately operated application service. Vercel
injects the pooled runtime and unpooled migration connection URLs. Neon Auth remains disabled.

The Google Sign-In step requests basic identity scopes. Google Health consent is a separate
OAuth flow using the same Google web client ID but requesting health-data scopes and offline
access. These flows must not be merged.

### Allowlist enforcement

- [`src/auth/allowlist.ts`](../../src/auth/allowlist.ts) normalizes email addresses
  case-insensitively, trims whitespace, and fails closed when the variable is absent or
  empty.
- [`src/auth/auth.ts`](../../src/auth/auth.ts) checks the allowlist before better-auth creates
  a user and again before it creates a browser session. A previously created user cannot
  create a new session after removal from the allowlist.
- `/api/auth/google-health/start` requires an authenticated better-auth session, so an
  unapproved account cannot start the health-consent flow through the supported route.
- [`app/api/[transport]/route.ts`](../../app/api/[transport]/route.ts) requires a valid
  better-auth MCP bearer token. The token's better-auth user ID is resolved to the domain
  user by email before any health service is constructed.

The public Vercel deployment must remain reachable without Vercel Deployment Protection;
the application-level OAuth and allowlist are the runtime perimeter.

### User and data isolation

The database is structurally capable of holding more than one approved user, but it is not a
public tenancy commitment:

- `app_users.email` is unique and is the bridge from the better-auth user.
- Each app user has at most one `google_health` row in `oauth_connections`.
- Each connection has its own encrypted Google token row.
- Google Health clients are constructed with the resolved `app_users.id`; connection and
  token lookups are user-scoped.
- Health cache entries and freshness rows are unique per user and cache/data-type key.
- Mutation audit rows carry the acting app user's ID.
- The Google Health OAuth state records the intended app user and rejects a callback used by
  a different signed-in user.

### Token and request security

- Google Health access and refresh tokens are encrypted at rest with AES-256-GCM. The
  database stores ciphertext, IV, authentication tag, and key version—not plaintext tokens.
- Environments that share the same Neon database must share the same
  `TOKEN_ENCRYPTION_KEY`; rotating or splitting it orphans stored Google tokens and requires
  reconnection.
- Errors and logs pass through the redaction helpers; tokens, authorization headers,
  cookies, client secrets, database credentials, and similar material must never be logged.
- The Google Health consent state is hashed, expiring, single-use, and bound to the intended
  app user.
- MCP access tokens are short-lived; MCP refresh tokens roll with a 60-day idle window.
- Google Health access-token refresh uses an atomic, expiring database claim so concurrent
  serverless requests do not all refresh the same connection.
- All routes use the Node runtime. Health writes are Zod-validated, explicit-input-only, and
  audit-logged. Tool responses remain bounded and non-diagnostic, with freshness metadata.

### Revocation behavior

The allowlist is evaluated during better-auth user and browser-session creation. The current
better-auth MCP plugin validates already-issued MCP access and refresh tokens by token-table
lookup and expiry; it does not recheck `ALLOWED_GOOGLE_EMAILS` on every MCP request or token
refresh.

Therefore, removing an address from `ALLOWED_GOOGLE_EMAILS` prevents new sign-ins but is not
an immediate full revocation by itself. Immediate offboarding requires all of the following:

1. Remove the identity from `ALLOWED_GOOGLE_EMAILS` in every environment and redeploy.
2. Revoke/delete that user's active better-auth sessions and MCP access/refresh tokens.
3. Revoke or remove that user's stored Google Health connection and encrypted Google tokens.

This is an operational requirement of the current implementation. A future code change may
add per-request allowlist enforcement, but it must preserve the fail-closed boundary.

### Current Google Health scope and tool boundary

The consent flow currently requests six read scopes and three write scopes for activity and
fitness, health metrics and measurements, sleep, nutrition, profile, and settings. The MCP
surface exposes read tools/resources plus writes for nutrition, hydration, and measurements.
Sleep, exercise, and settings writes are absent by design. `update_profile` is not registered
because the live Google endpoint returned `MISSING_OAUTH_SCOPE` despite the documented
`profile.writeonly` grant; its service code remains dormant.

This ADR neither broadens nor narrows the health scope set. Any scope change must follow the
minimum-necessary rule and requires the approved users to re-consent.

## Consequences

### Benefits

- No public OAuth verification project or recurring CASA assessment is undertaken.
- The threat surface, support burden, data-deletion population, and compliance obligations
  remain bounded to two known people.
- The existing implementation, encrypted token store, DCR compatibility, and deployed
  client flows remain intact.
- Google Health quota and request-cost uncertainty remain operationally negligible at this
  traffic level.

### Costs and accepted limitations

- The approved users see Google's unverified-app warning during Google Health consent.
- Access changes are manual and must be kept synchronized across local and production
  environment configuration.
- Immediate offboarding needs explicit token/session/connection revocation in addition to an
  allowlist edit.
- The database remains user-scoped, but there is no commitment to public tenant management,
  self-service deletion, generalized onboarding, public support, or public SLAs.
- Features whose only justification is a public or commercial audience are out of scope.

## Alternatives considered and rejected

### Public verified application

Rejected. Supporting arbitrary Google accounts would require restricted-scope OAuth
verification, CASA, public legal/disclosure/deletion surfaces, security review and
remediation, abuse controls, and ongoing annual reassessment. There is no current product
need that justifies those obligations.

### Open the unverified app to the first 100 users

Rejected. The cap is lifetime and non-resettable, users would receive a warning, and Google
expects apps that are ready for public launch to complete verification. The cap is a testing
or limited-use allowance, not this project's growth strategy.

### Google Workspace internal-only application

Rejected. The approved users use external/personal Google identities and are not one managed
Workspace organization. Internal-only audience mode would not implement the desired access
set.

### Bring-your-own Google Cloud project or self-hosted copies

Rejected. Requiring every user to create OAuth credentials and operate a deployment would
avoid a shared public audience but would replace a simple private service with a complex,
unsupported distribution product.

## Superseding this decision

Do not infer permission to broaden access from the multi-user-capable schema, open DCR, spare
Google quota, lack of current per-request charges, or an additional request to add a user.

A proposal for public or expanded access must be a new ADR approved by Emmett and must, at a
minimum, explicitly address:

- the exact audience and commercial/personal-use model;
- Google OAuth verification and annual CASA ownership and budget;
- minimum-scope review, including dormant or unused permissions;
- public privacy policy, terms, in-product disclosure, and affirmative consent;
- third-party LLM data sharing and retention/training guarantees;
- account disconnection, data deletion, and immediate revocation;
- cross-user isolation tests, abuse prevention, rate limiting, monitoring, and incident
  response; and
- migration and rollback for the two existing approved users.

Until such an ADR is accepted, the answer to public access is **no**.

## Evidence and references

Repository implementation reviewed for this decision:

- `src/auth/`, including the allowlist, better-auth configuration, health OAuth state, token
  storage, and refresh lifecycle
- `app/api/[transport]/route.ts` and `src/mcp/register-tools.ts`
- `src/db/schema.ts` and `src/db/auth-schema.ts`
- `src/security/`, `src/health-services/`, the unit tests, live E2E scripts, and current
  operational documentation

External references reviewed on 2026-07-10:

- [Google Health API app verification](https://developers.google.com/health/app-verification)
- [Google Health API quotas and rate limits](https://developers.google.com/health/rate-limits)
- [Google Health API setup and OAuth](https://developers.google.com/health/setup)
- [Google Health API Developer and User Data Policy](https://developers.google.com/health/policies/health-api-developer-user-data-policy)
- [Google OAuth verification FAQ](https://support.google.com/cloud/answer/13463817?hl=en)
- [Google restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
