/**
 * Resolved from https://cdn.shaughv.com/tree.json on 2026-07-29.
 * Re-fetch the manifest before changing any SHAUGHV asset URL.
 */
export const SHAUGHV_ASSETS = {
  fontsCss: "https://cdn.shaughv.com/fonts/fonts.css",
  fonts: {
    makiraRegular:
      "https://cdn.shaughv.com/fonts/makira/woff2/Makira-Regular.woff2",
    makiraExtraBold:
      "https://cdn.shaughv.com/fonts/makira/woff2/Makira-ExtraBold.woff2",
    gailRockRegular:
      "https://cdn.shaughv.com/fonts/gail-rock/woff2/Gail-Rock-Regular.woff2",
    gailRockSemiBold:
      "https://cdn.shaughv.com/fonts/gail-rock/woff2/Gail-Rock-Semibold.woff2",
  },
  wordmark:
    "https://cdn.shaughv.com/brand/shaughv/logos/SHAUGHV-Official.svg",
  animatedMark: "https://cdn.shaughv.com/js/animated-brand-mark.js",
  loader: "https://cdn.shaughv.com/js/shaughv-loader.js",
} as const;
