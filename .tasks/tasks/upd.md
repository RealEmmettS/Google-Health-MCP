TT;DR: Convert Google webhook change signals into a deduplicated MCP-readable update inbox so clients and later automations can discover meaningful new data.

## Why

Emmett requested proactive updates. MCP cannot independently start a Claude or ChatGPT conversation, but it can expose durable pending updates that clients or an external automation can poll and acknowledge.

## Scope

Add an update-inbox table/service, `get_health_updates` tool, and `health://updates` resource. Build update items from verified webhook pointers plus bounded cached trend refreshes; deduplicate by user/data type/interval and expose pending/read state. No email, SMS, or autonomous outbound message is sent.

## Plan

Define inbox lifecycle and retention; create items from webhook processing after durable event storage; expose list/acknowledge semantics; add scheduled refresh only where execution is durable and bounded.

## Impact

Trusted MCP clients gain a “what changed?” surface. Risks are notification spam, repeated updates, stale summaries, and implying a push guarantee MCP does not provide.

## Acceptance

**Functional bar:** webhook signals produce deduplicated pending updates that an authenticated user can list and acknowledge.
**Evidence bar:** authorization/isolation, dedupe, ordering, retention, cache invalidation, and live webhook-to-inbox evidence.
**Gate ownership:** automated gates are repository policy; selecting an outbound delivery channel is explicitly deferred to Emmett.
**Valid bounded outcomes:** verified MCP inbox, partial if live webhook registration is pending, or blocked on Google authentication.
**Budget / stop rule:** no outbound channel is added without a separate explicit destination decision.

## Verification

- [ ] Webhook duplicates create one pending update
- [x] Only the owning user can list or acknowledge updates by server-resolved app-user id
- [x] Update rows expire after seven days and deletion/disconnect removes them
- [x] `get_health_updates` and `health://updates` remain bounded and pointer-labeled
- [ ] A real Google notification becomes a visible inbox item

## Status

ACTIVE. Schema/service/tool/resource/acknowledgement and retention are implemented. Duplicate and real-delivery evidence depend on the production subscriber.

## Activity

- 2026-07-25 04:05 — created from Emmett's direct request for proactive behavior, with outbound delivery explicitly deferred (agent: codex)
- 2026-07-25 11:00 — implemented seven-day deduplicated pointer inbox, bounded list/acknowledge tools, `health://updates`, daily retention, and disconnect/delete cleanup (agent: codex)
