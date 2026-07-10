import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { SHAUGHV_ASSETS } from "./brand-assets";
import "./globals.css";

export const metadata: Metadata = {
  title: "SHAUGHV Health / Private Google Health MCP",
  description:
    "A private, allowlist-only Google Health MCP bridge for trusted AI assistants.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://cdn.shaughv.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={SHAUGHV_ASSETS.fontsCss} />
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
          href={SHAUGHV_ASSETS.fonts.makiraRegular}
        />
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
          href={SHAUGHV_ASSETS.fonts.makiraExtraBold}
        />
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
          href={SHAUGHV_ASSETS.fonts.ibmPlexMonoRegular}
        />
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
          href={SHAUGHV_ASSETS.fonts.ibmPlexMonoSemiBold}
        />
      </head>
      <body>
        {children}
        <Script src={SHAUGHV_ASSETS.animatedMark} strategy="lazyOnload" />
        <Script src={SHAUGHV_ASSETS.loader} strategy="lazyOnload" />
      </body>
    </html>
  );
}
