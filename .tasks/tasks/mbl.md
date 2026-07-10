TT;DR: Tighten the public homepage hero headline on small phones and remove the root minimum-width rule that creates horizontal scrolling at the 320 px boundary.

## Why
The public “HEALTH, CONNECTED.” headline is too close to the hero panel edge on narrow mobile screens. At a 320 px viewport, the root's `min-width: 320px` also exceeds the scrollbar-reduced content width, producing horizontal page scroll.

## Plan
1. Reproduce the homepage at narrow mobile widths and record the title, panel, and document geometry.
2. Make the smallest UI-only CSS adjustment: let the root shrink naturally and reduce the headline scale below 420 px.
3. Recheck mobile and desktop rendering, console health, sign-in control behavior, and the normal typecheck/test/build gates.

## Verification
- [x] 320 px and 375 px: no horizontal document overflow
- [x] 320 px and 375 px: “HEALTH, CONNECTED.” stays fully inside the hero panel with comfortable inset
- [x] Desktop homepage remains visually unchanged above the mobile breakpoint
- [x] Page identity, meaningful DOM, framework-overlay, and console checks pass
- [x] Sign-in control remains present and enabled
- [x] `npm run typecheck`, `npm test`, and `npm run build` pass
- [x] Full local DCR → authorize → form-token → bearer MCP regression harness passes

## Status
Done. The root no longer forces a 320 px minimum, the below-420 px hero type scale is smaller with safer line height, and all responsive, build, test, and OAuth/MCP regression checks pass.

## Activity
- 2026-07-10 — reproduced the narrow-viewport edge case at 320 px; confirmed the headline is at its content limit and the root minimum width creates horizontal scroll; began a UI-only fix (agent: codex)
- 2026-07-10 — verified no document overflow at 320/375 px, 18 px minimum headline breathing room at 320 px, exact desktop geometry parity with production at 1440 px, console/DOM/button health, typecheck, 74/74 tests, build, and the full local OAuth/MCP E2E chain; task complete (agent: codex)
