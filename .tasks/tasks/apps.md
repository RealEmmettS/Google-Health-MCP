TT;DR: MCP Apps are a stable, optional UI extension that this split-SDK v2 server can support without changing auth or its existing tools. The portable contract and repo seams are verified; Emmett's host, invocation, and read/write choices are needed before architecture and implementation.

## Why

Emmett directly asked for an optional view/dashboard that agents can use now that the server runs the official MCP SDK v2 and the newer protocol supports Apps. The architectural choice depends on the real standardized UI contract, host implementation differences, and whether this should be a read-only visualization, an interactive MCP client, or a mixed control surface.

## Scope

In scope: primary-source MCP Apps research; official SDK/host support; audit of the current v2 server, tools, resources, health services, auth, and deployment constraints; product classification; privacy and interaction boundaries; an implementation-ready architecture and verification matrix.

Out of scope until classified: implementation, deployment, connector reauthentication, Google Health reconsent, new health write semantics, public access, a standalone REST API, autonomous outbound notifications, or treating an App render as evidence for the open `#q2`, `#w11`, or `#upd` gates. The server remains private and allowlist-only under ADR-0002.

Authoritative sources are the current MCP specification/official SDK documentation, official target-host documentation, this repo's `docs/PLAN.md` and ADRs, the installed package/lockfile, and the live source tree. Time-sensitive host support must be checked live rather than recalled.

## Plan

1. Verify the current standard: UI resource declaration, tool-to-view linkage, app/host bridge, lifecycle, capability negotiation, permissions/CSP, and graceful fallback.
2. Verify current host and SDK support, separating portable MCP Apps behavior from vendor-specific extensions.
3. Audit this repo for the smallest reusable seams and identify any v2 or Next.js/Vercel constraints.
4. Ask only the classification questions whose answers change the architecture or risk boundary.
5. Record the selected product shape, phased implementation ladder, security model, and concrete evidence gates; create linked implementation work once its finish line is known.

Near-term prediction: the portable core will be a tool-associated HTML UI resource that receives structured tool results and communicates with its host through the standardized App bridge, while host-specific conveniences and tool-call permissions will require explicit compatibility handling. Oracle: current primary documentation plus installed package types/examples. Redirect condition: if the current standard or target hosts do not support the required interaction model, narrow phase one to the smallest portable read-only view and keep richer behavior host-specific or deferred.

## Impact

This task changes only tracked planning/research state. A later App could make health summaries easier to inspect, but it also creates a new rendering and interaction boundary around sensitive data. Risks include leaking health values into static resources/logs, broad tool invocation from an iframe, host-specific lock-in, misleading freshness/medical presentation, duplicating service logic in UI routes, and coupling a view to open connector/auth qualification.

## Acceptance

**Functional bar:** a documented, evidence-backed answer to what current MCP Apps support and an operator-approved product classification precise enough to implement without guessing.

**Evidence bar:** primary-source spec/SDK/host citations; source audit with exact integration seams; explicit portable-versus-host-specific capability matrix; security/privacy boundary; graceful-degradation behavior; and a verification plan covering automated contracts plus at least one real target host.

**Gate ownership:** Codex owns research and local/source evidence. Emmett owns the product-classification choices and any later owner-visible host acceptance. Google reconsent, credential changes, connector removal, destructive cleanup, and production deployment retain their existing approval/acceptance boundaries.

**Valid bounded outcomes:** implementation-ready portable App plan; a smaller read-only phase-one plan with richer interaction deferred; or a documented host/spec blocker. Stop after current primary sources, installed SDK/types/examples, and the named target-host docs have produced a discriminating classification; do not expand into a generic standalone dashboard unless Emmett chooses it.

## Evidence

| Criterion | Oracle / invocation | Raw result or pointer | Interpretation | Limitation | Status |
|---|---|---|---|---|---|
| Board/project starting state | `.tasks/TASKS.md`, Active task details, board `/api/ping` | Board 1.1.1 is live for this repo at port 4317; stable 1.0.0 is deployed while connector, DPoP, soak, and webhook gates remain open | Apps work is isolated from incomplete release evidence | Apps research does not close any of those gates | PASS |
| Stable Apps contract | [MCP Apps 2026-01-26 specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), [official overview](https://modelcontextprotocol.io/extensions/apps/overview) | Extension id `io.modelcontextprotocol/ui`; tool `_meta.ui.resourceUri`; `ui://` resource; `text/html;profile=mcp-app`; sandboxed JSON-RPC bridge | Apps are an optional standard extension, not a replacement transport or a standalone web dashboard requirement | Hosts may implement only a subset of optional capabilities | PASS |
| Current v2 negotiation | [MCP extensions overview](https://modelcontextprotocol.io/extensions/overview), installed `@modelcontextprotocol/server@2.0.0` types | Client extension capabilities arrive per request under `_meta`; server support is advertised through `server/discover`; `ServerCapabilities.extensions` accepts the Apps extension | Use 2026-07-28 extension discovery for this server while retaining legacy text behavior | Older Apps examples still show initialize-era negotiation | PASS |
| Host behavior | [OpenAI Apps UI guide](https://developers.openai.com/plugins/build/chatgpt-ui), official MCP Apps overview | ChatGPT implements the standard and recommends decoupled data/render tools; Claude, VS Code Copilot, Microsoft 365 Copilot, Goose, Postman, MCPJam, and Archestra are listed as supporting hosts | Build to the shared bridge and feature-detect optional host capabilities; keep ChatGPT-only APIs optional | No primary-source confirmation was found for Codex Desktop or Cursor rendering, so both remain fallback targets until a real-host probe | PASS |
| SDK compatibility | `npm view`, `npm pack @modelcontextprotocol/ext-apps@1.7.5`, installed package declarations, construction spike | Latest ext-apps server helpers import monolithic `@modelcontextprotocol/sdk` `^1.29.0`; split v2 `McpServer` natively accepts extension capabilities, arbitrary tool/resource `_meta`, and the App MIME/resource URI | Register the standard metadata/resource directly on split SDK v2; do not add a second MCP runtime or downgrade the server | The browser-side bridge packaging choice remains for implementation design | PASS |
| Existing integration seam | `src/mcp/server.ts`, `src/mcp/register-tools.ts`, `app/api/[transport]/route.ts`, `src/health-services/*` | Request-scoped Node server; 18 tools; 6 JSON resources; thin reusable status/steps/sleep/heart/exercise/nutrition/trends/context/update services; OAuth scope metadata already centralized | A bounded dashboard-data service/tool plus a presentation-only render tool can reuse current services and merge UI metadata with existing security schemes | Product scope determines the snapshot and whether any app-only refresh helper is justified | PASS |
| Product classification | Emmett decision | Pending: host targets, explicit versus automatic invocation, and read-only versus write controls | These choices change bundle compatibility, tool visibility, permission prompts, and acceptance testing | No implementation should begin from guesses | WAIT |

## Research outcome

- **Portable core:** register one or more ordinary MCP tools, link a tool to a predeclared `ui://` HTML resource through `_meta.ui.resourceUri`, return bounded `structuredContent` for the iframe, and retain meaningful text `content` for every non-App host. The host fetches the resource with `resources/read` and runs it in a sandbox.
- **Lifecycle and interaction:** the host and iframe negotiate over the standard `ui/*` JSON-RPC bridge (`ui/initialize`, tool input/result notifications, optional proxied `tools/call`, `resources/read`, `ui/message`, model-context updates, host-context changes, and teardown). Display modes, theme, locale, dimensions, safe areas, link opening, logging, and sandbox permissions are capability-driven rather than assumed.
- **Security boundary:** static UI HTML must contain no health values or secrets. Sensitive values travel only in authenticated tool results. The App resource should declare a narrow CSP, request no unnecessary sandbox permissions, make read-only behavior the default, and preserve all existing freshness/non-medical language. UI-initiated tool calls remain host-gated and OAuth-scoped.
- **Recommended repo shape:** add a bounded `get_health_dashboard` data tool/service plus a presentation-only `render_health_dashboard` tool and versioned `ui://health/dashboard-v1.html` resource. The model fetches the authoritative snapshot, can reason over it, then passes the checked snapshot to the render tool; local UI refreshes can call the data tool when the host permits. Merge `_meta.ui` beside existing OAuth `securitySchemes`, advertise `io.modelcontextprotocol/ui`, and leave all 18 existing tools useful without the view. This follows OpenAI's decoupled data/render guidance and avoids remounting a dashboard after every ordinary read.
- **Compatibility decision:** do not use the current ext-apps server helper wrappers because they would add the pre-v2 monolithic SDK beside the installed split server. The v2 server already exposes the small standard registration surface needed. The UI bundle may still use the browser bridge portion if its dependency/runtime footprint proves isolated; otherwise implement the small standard postMessage bridge directly and contract-test it.

## Verification

- [x] Current MCP Apps protocol/resource/bridge/lifecycle contract is cited from primary sources
- [x] Official SDK implementation path and installed v2 package compatibility are verified
- [x] ChatGPT and other intended host support is separated into portable and host-specific behavior
- [x] Existing server/services/auth/runtime integration seams and preservation invariants are audited
- [ ] Emmett's dashboard classification decisions are recorded
- [ ] Chosen architecture, security boundary, fallback behavior, and phased verification matrix are implementation-ready

## Status

ACTIVE — WAITING ON CLASSIFICATION. Primary-source research, current package inspection, and the server/service audit are complete. No implementation, auth, connector, or deployment behavior changed. Next: record Emmett's host, invocation, and write-scope choices; then finish the architecture and open bounded implementation work.

## Activity

- 2026-08-01 01:17 — created from Emmett's direct request, moved directly to Active, and bounded Apps work away from open release/webhook evidence and destructive auth actions. (agent: codex)
- 2026-08-01 02:06 — verified the stable Apps extension contract, current v2 discovery model, official host support, and latest package ecosystem; confirmed the ext-apps 1.7.5 server helpers still target the monolithic SDK while the installed split server 2.0.0 can register the standard contract directly. Audited the request-scoped endpoint, centralized OAuth tool metadata, six resources, eighteen tools, and reusable health services. Paused implementation at the three product choices that change architecture. (agent: codex)
