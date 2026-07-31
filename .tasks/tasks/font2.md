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
- [x] Consent UI passes the 320–1920 px portrait/landscape viewport matrix with exact
      100vw × 100dvh framing, no document or internal clipping, and 44 px-or-larger controls
- [ ] Signed-in consent accept/deny redirects pass during the owner-approved connector reconnect
- [x] CDN fonts return 200 with expected CORS and immutable caching
- [x] MCP icon download serves the supplied PNG under a clean filename without responsive overflow
- [x] Enlarged utility and consent typography preserves signed-out no-scroll and signed-in first-card framing
- [x] Owner Chrome renders the signed-in production page at 100% zoom with no horizontal overflow

## Status

ACTIVE. Makira/Gail Rock variables, preloads, technical selectors, feature isolation, and the
private consent UI are live. The larger responsive scale passes local and production viewport
qualification, including a fully framed signed-in first card. The apparent follow-up scale
regression was isolated to a persisted 67% Chrome site zoom and corrected to 100%; no compensating
production CSS change was warranted. The decorative panel rail is now removed globally. The
consent surface has been rebuilt as a fixed, no-scroll 100vw × 100dvh sheet whose normal controls
and fail-closed state pass phone portrait, phone landscape, tablet, and desktop qualification.
Deployment `dpl_4B6kSU8LMuJeBvt4Twjb6Cf7KRhv` is READY and live on the canonical domain with
the same matrix passing against a real ChatGPT registration. The signed-in accept/deny redirect
remains coupled to the owner reconnect.

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
- 2026-07-31 01:52 - Raised the small Gail Rock utility type across account, status, connector,
  endpoint, icon, and consent details; removed the public/consent card's decorative green rail; and
  replaced the gold offset primary-button slab with a neutral diffused shadow. Local Chrome and
  responsive Playwright proof kept the signed-out page at exact viewport height with no overflow at
  1920x855, 768x900, 390x844, and 390x667. Fail-closed consent fits 1920x855 and 1280x720, retains
  54px actions, and intentionally scrolls vertically without horizontal overflow at 390x844.
  Production signed-in first-card proof remains pending deployment. (agent: codex)
- 2026-07-31 02:04 - Production deployment `dpl_74z3BNq9bU9tJcZyiJtSftMhDs3x` proved the
  enlarged type and revised depth treatment live. Signed-out Chrome/Playwright remains exact-height
  and overflow-free at 1920x855 and 390x844; its accent pseudo-element resolves to `none`, the
  primary button retains a 54px target with a neutral shadow, and the desktop panel ends at 819px.
  Signed-in Chrome has no horizontal overflow and the complete first card ends at 822px in its
  1282px CSS viewport. Production fail-closed consent ends at 778px in 855px, shows all three larger
  capabilities, and keeps both 54px actions in frame. (agent: codex)
- 2026-07-31 02:25 - Investigated Emmett's follow-up signed-in screenshot and measured Chrome at
  67% site zoom (`devicePixelRatio=0.6667`, 2880px CSS viewport). Reset the live
  `health.emmetts.dev` tab to 100%, restoring a 1920px viewport and the intended scale. At 100% the
  complete first card ends at 800px in a 911px viewport, the next section begins at 836px, horizontal
  overflow is zero, and the console is clean. Vercel independently reports production deployment
  `dpl_75KAgLanzmeXu9GUuyRnb1wYCvcE` READY on exact main commit `9055bf1`. (agent: codex)
- 2026-07-31 02:32 - Reopened visual acceptance after Emmett showed the remaining green rail on the
  signed-in Google Health panel. The rail came from the separate `.surface-panel::before` selector;
  removing the entire decorative pseudo-element family so it cannot recur across public, signed-in,
  consent, or privacy panels. (agent: codex)
- 2026-07-31 02:52 - Removed the complete panel-rail pseudo-element family and rebuilt consent as
  an exact viewport sheet. Chrome box-level qualification passed both normal Allow/Deny controls
  and fail-closed errors at 320x568, 360x640, 390x667, 390x844, 430x932, 568x320, 667x375,
  844x390, 768x1024, 1024x768, 1280x720, 1366x768, 1440x900, and 1920x1080: every document and
  main box exactly matched the viewport, every consent child remained visible, no internal content
  overflowed, and controls stayed 49.7-54 px tall. All 149 tests, typecheck, and production build
  pass. Production release proof remains. (agent: codex)
- 2026-07-31 02:56 - Vercel production deployment `dpl_4B6kSU8LMuJeBvt4Twjb6Cf7KRhv`
  reached READY in `iad1` on exact implementation commit `6f06e9b`. Signed-in Chrome at the
  restored 1920x911 viewport shows the first panel fully framed at 800px, the next section beginning
  at 836px, no horizontal overflow, and the former `.surface-panel::before` rail resolving to
  `none`. The live consent page loaded the real ChatGPT client with both actions and passed the full
  14-viewport matrix from 320x568 through 1920x1080 with exact document/main viewport dimensions,
  no clipped child or internal overflow, and 49.7-54px controls. Production fail-closed checks also
  passed at 320x568, 568x320, and 1440x900; the deployment emitted no error/fatal runtime logs.
  (agent: codex)
