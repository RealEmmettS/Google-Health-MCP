TT;DR: Apply the live SHAUGHV CDN two-family contract—Makira for body/display and Gail Rock for technical UI—to the existing site and new private OAuth consent page.

## Why

The current site already uses the combined CDN stylesheet and Makira, but its monospace contract still points at IBM Plex Mono. The new consent surface should feel native to the existing private product rather than like an authorization-provider default.

## Scope

Re-fetch the live CDN guide and manifest immediately before editing; retain the manifest-provided combined stylesheet; replace IBM font preloads/variables with Gail Rock Regular and Semibold; scope `"zero" 1` to monospace content; prevent Makira feature leakage; reuse the same language, responsive behavior, keyboard/touch behavior, and reduced-motion handling on consent UI. No font redistribution.

## Plan

1. Resolve exact font URLs and integration rules from the live guide/manifest.
2. Patch preloads and CSS variables/features.
3. Implement the provider consent page with the existing design system.
4. Verify 390/768/1440 layouts, keyboard/touch/reduced motion, redirects, CORS/cache headers, and absence of IBM requests.

## Impact

Public presentation and private authorization screens change visually; health data and API behavior do not.

## Acceptance

Makira and Gail Rock load from manifest-provided URLs without layout shift or overflow, and the consent flow remains accessible and exposes no health data.

## Verification

- [ ] Live `/agents` and `/tree.json` evidence captured immediately before editing
- [ ] IBM Plex Mono references and requests are removed
- [ ] Gail Rock Regular/Semibold preloads and narrowly scoped zero feature work
- [ ] Consent accept/deny flow is keyboard, touch, reduced-motion, and viewport qualified
- [ ] CDN fonts return 200 with expected CORS and immutable caching

## Status

TO-DO. Live CDN inventory was confirmed during planning; it will be refreshed again at the required edit boundary.

## Activity

- 2026-07-29 01:45 - Created under `#mcp2` from Emmett's explicit request to update the whole site typography alongside the new consent UI. (agent: codex)
