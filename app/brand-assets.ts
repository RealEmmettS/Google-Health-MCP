/**
 * Resolved from https://cdn.shaughv.com/tree.json on 2026-07-10.
 * Re-fetch the manifest before changing any SHAUGHV asset URL.
 */
export const SHAUGHV_ASSETS = {
  fontsCss: "https://cdn.shaughv.com/fonts/fonts.css",
  fonts: {
    makiraRegular:
      "https://cdn.shaughv.com/fonts/makira/woff2/Makira-Regular.woff2",
    makiraExtraBold:
      "https://cdn.shaughv.com/fonts/makira/woff2/Makira-ExtraBold.woff2",
    ibmPlexMonoRegular:
      "https://cdn.shaughv.com/fonts/ibm-plex-mono/woff2/IBMPlexMono-Regular.woff2",
    ibmPlexMonoSemiBold:
      "https://cdn.shaughv.com/fonts/ibm-plex-mono/woff2/IBMPlexMono-SemiBold.woff2",
  },
  wordmark:
    "https://cdn.shaughv.com/brand/shaughv/logos/SHAUGHV-Official.svg",
  faviconDark:
    "https://cdn.shaughv.com/brand/shaughv/favicons/SHAUGHV-Favicon-Dark.svg",
  faviconLight:
    "https://cdn.shaughv.com/brand/shaughv/favicons/SHAUGHV-Favicon-Light.svg",
  animatedMark: "https://cdn.shaughv.com/js/animated-brand-mark.js",
  loader: "https://cdn.shaughv.com/js/shaughv-loader.js",
} as const;
