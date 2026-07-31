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

- [x] Live `/agents` and `/tree.json` evidence captured immediately before editing
- [x] Active IBM Plex Mono references/preloads are removed
- [x] Gail Rock Regular/Semibold preloads and narrowly scoped zero feature work
- [x] Public/fail-closed consent UI passes 390/768/1440, focus, touch, reduced-motion, and overflow checks
- [ ] Signed-in consent accept/deny redirects pass during the owner-approved connector reconnect
- [x] CDN fonts return 200 with expected CORS and immutable caching
- [x] MCP icon download serves the supplied PNG under a clean filename without responsive overflow

## Status

ACTIVE. Makira/Gail Rock variables, preloads, technical selectors, feature isolation, and the
private consent UI are live. The larger responsive scale passes local and production viewport
qualification, including a fully framed signed-in first card and short-desktop consent card plus
intentional mobile consent scroll instead of clipping. The signed-in accept/deny redirect remains
coupled to the owner reconnect.

## Activity

- 2026-07-29 01:45 - Created under `#mcp2` from Emmett's explicit request to update the whole site typography alongside the new consent UI. (agent: codex)
- 2026-07-29 03:58 - Re-read the live CDN guide/manifest; retained the combined stylesheet,
  replaced IBM with Gail Rock Regular/Semibold preloads, scoped `"zero" 1` only to technical
  content, and reused the site language on fail-closed consent UI. Live font assets returned 200
  with wildcard CORS and immutable one-year caching. (agent: codex)
- 2026-07-29 04:25 - Production browser QA passed at 390/768/1440 with no horizontal overflow;
  Makira body/display and Gail Rock technical computed styles loaded, IBM had zero asset references,
  focus outlines were visible, primary/consent tap targets were 54 px, reduced-motion collapsed
  reveal timing to 0.01 ms, and the console was clean. The unauthenticated consent state failed
  closed with disabled actions and no health values. Signed-in redirects stay open for reconnect.
  (agent: codex)
- 2026-07-29 18:12 - Corrected the signed-in connector guide after Emmett's visual review, then
  removed the two redundant web-client instruction cards entirely on follow-up. The section now
  contains only the raw endpoint plus Codex CLI and Claude Code commands, eliminating the crossed
  pairings and duplicated `Custom connector` treatment while reducing its vertical footprint.
  (agent: codex)
- 2026-07-29 18:25 - Tightened brand/header, panel, status, and copy-card proportions with
  height-aware spacing. The signed-out home is now a fixed dynamic-viewport composition rather
  than a clipped page: Chrome measured exact document-to-viewport dimensions with no overflow at
  1920x911, 390x844, and short-mobile 390x667 while retaining every control and service label.
  (agent: codex)
- 2026-07-29 18:50 - Added Emmett's supplied 1254px MCP artwork byte-for-byte as the clean
  `shaughv-health-mcp-icon.png` public download, with a compact preview/action in Connector setup.
  The change passed all 147 tests, typecheck, and the production build before release.
  (agent: codex)
- 2026-07-29 19:03 - Production deployment `dpl_FatMUMj1mFQFYKLGPMUd3aCwguKK` reached READY
  in `iad1`. The live asset returned 200 as `image/png`, 910,687 bytes, with the exact source hash;
  the link advertised `shaughv-health-mcp-icon.png`. Signed-in Chrome QA passed at 1920x855 and
  390x844 with a visible 58px-tall action, zero horizontal overflow, and no console messages.
  (agent: codex)
- 2026-07-31 00:56 - Re-enlarged the public and signed-in design after Emmett's live sizing
  feedback, then brought the consent surface into the same scale and card language. Chrome proved
  exact no-scroll/no-overflow public layouts at 1920x911, 390x844, and 390x667; consent fully fits
  1440x900, 1920x855, 1366x768, and 1280x720, while 390px consent uses vertical scroll with no
  horizontal overflow. All consent controls retain at least 46px short-screen targets. (agent: codex)
- 2026-07-31 01:05 - Production Chrome QA on deployment
  `dpl_BXX6gM9UXVP7yRsNHMKEdnGzVXAR` proved the signed-in header and complete first card end at
  788px in a 1920x855 CSS viewport, with the next section beginning below the fold and no horizontal
  overflow. Live fail-closed consent rendered all three capabilities and 54px controls inside the
  same viewport with no panel overflow; Makira/Gail Rock computed correctly and both consoles were
  clean. (agent: codex)
