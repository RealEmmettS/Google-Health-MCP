# Critical Thinking Session — Google Health MCP 0.3.0 upgrade

**Date:** 2026-07-29
**Framework:** Design
**Mode:** Self-check
**Stacked skills:** logical-reasoning, tasks-start, tasks-management, shaughv-cdn, Vercel Functions/deployments

---

## Active Decision Packet

- **Objective / decision:** Implement MCP SDK v2, stable stateless JWT authorization, Google Health refresh-token DPoP, branded consent/UI typography, and production qualification without losing the working private service or Google connection.
- **Governing constraints and non-goals:** Emmett-only allowlist; Google-authoritative/non-diagnostic data; no token or health-payload logging; Node runtime; no Edge migration, Tasks, subscriptions, MRTR, public signup, beta auth packages, paid database branch, or premature physical-webhook closure.
- **Verified facts and exact evidence pointers:** Clean synchronized `main`; 114-test/typecheck/build baseline from planning evidence; current Vercel Node functions and Neon colocated in `iad1`/US East; 20 legacy registrations and 178 unexpired legacy refresh rows; current board upgraded to 1.1.1 at repo-local port 4318. Detailed source and decision evidence will live in the dated research report and hosting ADR.
- **Live assumptions / hypotheses:** Existing active connectors may not all support the 2026 protocol; stable SDK v2 stateless legacy mode will bridge them. Better Auth 1.6.25 custom model mapping is sufficient for additive physical tables. Google Health's token endpoint will honor Google's documented DPoP behavior; this remains an empirical gate, not a premise for destructive replacement.
- **Unresolved contradiction:** Modernizing auth requires a connector reconnect, while proving the transport checkpoint should preserve existing connectors. Resolve through separate 0.2.1 and 0.3.0 artifacts rather than one deployment.
- **Current decision:** Keep Vercel Node 24 Functions with Fluid Compute in `iad1`; implement transport first with legacy auth, then additive OAuth/JWT/DPoP.
- **Next bounded action and predicted observation:** Implement and locally test 0.2.1. Prediction: official SDK v2 serves modern discovery plus stateless legacy initialize/list/read/call without changing tool/resource semantics.
- **Archive sections needed for that action:** Facts, assumptions, design steps, argument audit, attempt ledger, production evidence.

---

## Pre-Flight: Inputs Inspected

### Inputs brought to the session

- Emmett's approved implementation plan: internal specification with explicit architecture, sequencing, compatibility, security, pricing, and acceptance requirements.
- Repository source/docs/ADR/task board: internal artifacts defining current behavior and non-negotiables.
- Official MCP, Better Auth, Google, Vercel, Neon, Cloudflare, and Railway materials: external primary documentation and package source inspected during planning.
- Live production/database/Vercel baseline: runtime and schema observations, not design claims.

### Source pass findings

- The operator specification is unusually complete and incorporates the prior research, but version-sensitive package behavior must still be verified against installed source and executable tests.
- Vendor claims about portability or cold starts do not establish application-level superiority. Data locality, dependency compatibility, durable auth needs, and client support are the load-bearing facts.
- Public client documentation does not prove every active connector already speaks the 2026 protocol; compatibility must be measured rather than assumed.

### What's already decided (not revisiting)

- Work directly on `main` through two rollback-safe releases.
- Vercel remains the host unless implementation evidence falsifies a critical assumption.
- Google Sign-In identity, Google Health consent, and MCP bearer authorization remain separate trust domains.
- Existing Google Health data/tokens and legacy MCP auth tables are never destructively migrated in the cutover deployment.

---

## Working Sections

### Facts

| Fact | Confidence | Source / surfaced at |
|---|---|---|
| MCP 2026 transport is request-scoped and does not require a session or initialize handshake. | High | Official specification and SDK v2 source, planning research |
| SDK v2's handler supports modern requests and stateless legacy fallback with a new server per request. | High | Official SDK migration docs/source, planning research |
| Current application uses Node crypto, Better Auth, Neon, encrypted Google credentials, and Google APIs. | High | Repository inspection |
| Neon and current Vercel functions are colocated in US East/`iad1`. | High | Live configuration inspection |
| Google upstream credentials cannot serve as MCP resource-server bearer tokens. | High | MCP authorization/security requirements plus audience separation |
| Stateless JWT access verification removes the access-token DB lookup but not client, refresh, consent, Google-token, cache, webhook, or audit persistence. | High | Protocol/provider model and application requirements |
| Existing legacy OAuth state is material enough that a staged rollback window is required. | High | Live aggregate counts |
| Exact current Vercel billing tier is not exposed by the available connector. | High | Connector inspection; must stop if deployment UI/CLI presents a paid requirement |

### Assumptions

| Assumption | Status | Surfaced at | Notes |
|---|---|---|---|
| Stable SDK v2 can preserve all existing tool/resource contracts. | open | Design Step 3 | Must pass contract and legacy-client tests. |
| Every required Better Auth provider model can map to additive physical tables. | open | Design Step 3 | Verify against exact 1.6.25 types/source and generated migration. |
| Active clients tolerate the 0.2.1 transport with legacy auth. | open | Design Step 4 | Production connector matrix is the oracle. |
| Google Health token exchange accepts documented DPoP. | open | Design Step 3 | Retry once on nonce; abort safely without token replacement if rejected. |
| Fluid Compute is already available without a new fixed charge. | tested | Design Step 2 | Vercel docs say it uses existing metered compute; still stop on any presented paid-plan gate. |

### Constraints

- **Privacy:** no bearer headers, OAuth codes/tokens, DPoP private keys, tool arguments/results, foods, or measurements in logs/errors.
- **Rollback:** 0.2.1 retains legacy auth; 0.3.0 uses only additive schema and retains old OAuth tables for seven days.
- **Compatibility:** `/api/mcp`, tool names, resource URIs, argument meanings, and JSON-text output remain stable.
- **Evidence ownership:** automated gates do not prove browser/connector/Google consent/time-based soak; those remain explicit operator or elapsed-time gates.
- **Cost:** no paid Neon branch or new service without first reporting it.

### Open questions

- Does exact SDK v2 behavior match the public migration examples under Next.js 16 and Node 24? Resolve through installed types/source and tests.
- Which active connector identities can be qualified non-interactively, and which require Emmett's browser/workspace action? Resolve at each production checkpoint.
- Does Google Health's OAuth endpoint accept DPoP and nonce behavior exactly as general Google OAuth docs specify? Resolve through safe explicit reconsent only after all unit/integration gates.

### Tensions

- **Stateless transport vs. durable application:** request state disappears, but user authorization and upstream refresh continuity remain durable by design.
- **Immediate revocation vs. local JWT verification:** account-level allowlist removal is immediate, while client-specific revocation is bounded by a one-hour JWT; emergency key rotation is the global kill switch.
- **Fast modernization vs. connector continuity:** solved through two artifacts and a legacy protocol telemetry window.

### Deferred items

- MCP Tasks/MRTR: revisit if operations regularly exceed 60 seconds or a durable queue becomes necessary.
- `subscriptions/listen`: revisit only with a real client requirement and durable multi-instance pub/sub.
- CIMD: revisit after maintained stable Better Auth support; do not hand-roll.
- Edge/Cloudflare/Railway: revisit if durable state becomes edge-native or measured Vercel cost/latency loses.

### Attempt ledger

| # | Relevant starting state | Intervention | Observation | Information gained | Verdict |
|---|---|---|---|---|---|
| 1 | Clean 0.2.0 production baseline | Upgrade task-board bundle only | 1.1.1 files hash-match source; repo board runs at port 4318 with correct root | Tracking infrastructure is current without application mutation | new evidence |

---

## Framework Steps

### Step 1: Empathize

**Sub-questions asked:** Who uses this, what pain exists, how is it handled now, and what does Emmett's future tired self need?

**Responses:** Emmett uses the service through ChatGPT, Claude, Codex, and Cursor and values reliable unattended health access over minimizing engineering work. The existing service works, but legacy session/auth architecture creates performance debt, security debt, and connector fragility. The future operator needs explicit rollback points, a single canonical URL, no manual token custody, a visible board, and honest separation of automated versus browser/device/time evidence.

**Insights:** Continuity and recoverability are primary user needs; raw edge placement is not. A one-shot rewrite would optimize the implementation diagram at the expense of the operating experience.

**Mode:** Convergent

### Step 2: Define the Problem

**Sub-questions asked:** What exactly is wrong, what must improve, what constraints govern it, and what success metrics matter?

**Responses:** Replace transport sessions and opaque access-token lookup without conflating that with eliminating durable OAuth or Google refresh credentials. Improve request latency, protocol fidelity, contract richness, and auth security while retaining every public MCP contract and current health data. Success requires modern plus legacy protocol tests, no per-request JWT DB lookup, exact audience/scope enforcement, safe DPoP replacement, active connector proof, and rollback evidence.

**Insights:** The correct boundary is a request-scoped resource server backed by durable authorization/upstream credential state—not a literally stateless application.

**Mode:** Convergent

### Step 3: Research

**Sub-questions asked:** Which maintained technologies already solve each layer, what limitations remain, and what alternatives provide real—not theoretical—benefit?

**Responses:** Official SDK v2 provides the request-scoped handler and legacy compatibility. Stable Better Auth OAuth Provider supplies JWT/DCR/PKCE/consent/hashed refresh primitives but not stable CIMD. Vercel Node+Fluid supplies full Node compatibility, streaming, concurrency, and compute near Neon. Edge placement adds cross-region data/auth hops and compatibility risk. Railway adds an always-on cost floor without a stateless-protocol advantage. Google still requires securely retained refresh credentials and documents DPoP hardening.

**Insights:** Use existing maintained primitives at their intended boundaries; do not hand-roll transport, OAuth Provider, CIMD, or global edge state.

**Mode:** Divergent then convergent

### Step 4: Ideate

**Sub-questions asked:** What distinct architectures could work, including an unconstrained and a deliberately bad option, and which best fits constraints?

**Responses:** Considered (1) Vercel Node+Fluid with SDK v2 and additive auth, (2) Vercel Edge, (3) Cloudflare Workers with reworked state/auth, (4) Railway long-running service/FastMCP, (5) split edge resource server plus regional auth/data service, and the worst option—one production rewrite that deletes legacy state immediately. Option 1 uniquely preserves locality, dependency compatibility, URL/deploy workflow, and rollback at expected zero fixed incremental cost.

**Insights:** The hosting decision is not inertia; it follows from colocated durable dependencies and the absence of a measured edge latency/cost problem.

**Mode:** Divergent then convergent

### Steps 5–8: Prototype, Test, Refine, Release

These steps are active and map to the two release checkpoints. The 0.2.1 source/test artifact is the first prototype; production connector evidence is its test. Only then does 0.3.0 become the higher-fidelity prototype. Release is incomplete until operator-owned reconnects and time-based soak are recorded in `#q2`.

---

## Logical Reasoning Audit

**Argument (standard form):**

1. A hosting/runtime choice is preferable only if it meets compatibility, security, locality, operability, and cost constraints better than available alternatives.
2. This application's request path depends on full Node APIs, regional Neon data, Better Auth state, encrypted Google credentials, and Google APIs.
3. Vercel Node+Fluid in `iad1` satisfies those constraints while retaining the proven deployment/rollback surface and adding request concurrency/sessionless transport.
4. Edge/Workers would add state/compatibility or cross-region costs; Railway adds a fixed service/cutover cost without solving a current capability gap.
5. No measured current latency, reliability, or cost evidence defeats the Node+Fluid option.
6. Therefore, keep the application on Vercel Node+Fluid in `iad1` for this release, with explicit reevaluation triggers.

**Support claimed:** Inductive practical recommendation.

**Connecting assumption:** Avoiding unnecessary migration risk has positive value when the retained platform fully supports the target architecture.

**Strength/cogency:** Strong, provided the exact SDK/provider APIs and production connector compatibility pass the staged gates. Those premises are empirical and remain open until execution.

**Fallacy scan:** No conclusion from protocol portability to edge superiority; no appeal to existing investment alone; no claim that transport statelessness eliminates authorization persistence.

---

## Steel-Manned Dissent

- **The case against:** A globally distributed Edge/Workers resource server could minimize client-network latency and better embody a serverless 2026 protocol; keeping Vercel Node may merely preserve legacy choices.
- **What would have to be true for it to be correct:** Health/auth requests would need little regional durable state, all dependencies would need clean Web-runtime support, and measured client-network latency would dominate Neon/Google/backend time enough to offset cross-region and migration costs.
- **How it was handled:** Rejected for this release, not permanently. The current dependency/data path contradicts those conditions; explicit measurement/state triggers reopen the decision.
- **Confidence in rejection:** High for 0.3.0; medium for long-term architecture because workload and platform economics can change.

---

## Closing (current checkpoint)

### Sanity check

- **Does the result make intuitive sense?** Yes. Stateless request handling improves the hot path, while durable credentials/consent remain where unattended access requires them.
- **What should be true if this conclusion is right?** 0.2.1 should work on Node+Fluid with modern and legacy clients, without an auth/data migration or latency regression. That prediction is the first executable gate.

### Decision / Conclusion

Keep Vercel Node+Fluid in `iad1` and execute the approved two-checkpoint migration. Do not proceed from 0.2.1 to the auth cutover on reasoning alone; require the production connector oracle.

### Exit state

**Directed** — implement and test the bounded 0.2.1 checkpoint.

### Confidence band on the conclusion

**High** on the architectural direction; **medium** on connector/Google DPoP compatibility until their external oracles run.

### Next steps

- Implement native SDK v2 transport/contracts and HTTP boundary: agent, current checkpoint.
- Qualify and deploy 0.2.1: agent plus active connector evidence.
- Implement/rehearse 0.3.0 auth/DPoP/UI only after that gate: agent, with Emmett for browser consent/reconnects.

### Open questions

- Exact connector support and Google DPoP behavior remain empirical, named gates.

### Spaced revisit

- **Revisit on:** 2026-08-05
- **Why:** Seven-day rollback/soak decision point after 0.3.0, if deployment timing permits.
- **Trigger:** Any connector incompatibility, paid-plan prompt, DPoP rejection, auth anomaly, >10% warm latency regression, or persistent legacy-protocol traffic.
