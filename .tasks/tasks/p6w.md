TT;DR: Ship the write tools — nutrition create/update/delete, hydration log, measurement updates (weight/body-fat/height), profile write only if the live API supports it — every mutation Zod-validated and audit-logged.

## Why
Emmett's explicit need: Fitbit Air doesn't track food; he wants to log/edit nutrition, hydration, measurements, and profile via the LLM. `docs/PLAN.md` §"MCP surface"; handoff §11.4.

## Plan
- Tools: create_nutrition_log, update_nutrition_log (patch by dataPointName), delete_nutrition_log (batchDelete by names), create_hydration_log (mL/L/fl_oz/cup → API unit), update_measurement (weight|body-fat|height via correct data types + scopes). Input schemas per handoff §11.4.
- update_profile: FIRST check live v4 REST reference for a writable profile endpoint + field list; implement narrowly or DROP the tool (record decision in this file). Do not invent fields.
- Every mutation: require write scope on connection (else missing_scope), audit row (tool, dataType, operation, request, response, dataPointName, status), return created/updated names.
- Data types: nutrition-log + hydration-log are the mutation targets (`food` is catalog/read-only). Edits target app-created points; warn/refuse on foreign data points if the API refuses.

## Impact
Real writes into Emmett's Google Health account. Safety: explicit-input-only (never inferred values), audit trail, no sleep/exercise/settings writes exist AT ALL (absent by design — do not scaffold them).

## Acceptance
Mocked CRUD suite green; on prod (Phase 7): a logged snack appears via get_nutrition_log AND in the Fitbit app after sync; audit rows exist; delete removes it.

## Verification
- [ ] Vitest mocked: create→update→delete nutrition roundtrip; hydration create; measurement create
- [ ] Audit row written for every mutation incl. failures (status + error_message)
- [ ] Write without write-scope → missing_scope error shape
- [ ] update_profile decision recorded here after checking live REST reference (implemented narrowly OR dropped)
- [ ] No sleep/exercise/settings write tool exists in the tool list

## Status
Not started. Prereq: #p5m.

## Activity
- 2026-07-09 00:15 — created from approved plan (agent: fable)
