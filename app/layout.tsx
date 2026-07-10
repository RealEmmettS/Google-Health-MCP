import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { SHAUGHV_ASSETS } from "./brand-assets";
import "./globals.css";

export const metadata: Metadata = {
  title: "SHAUGHV Health / Private Google Health MCP",
  description:
    "A private Google Health MCP bridge for the AI assistants I trust.",
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
        <link
          rel="icon"
          href={SHAUGHV_ASSETS.faviconDark}
          media="(prefers-color-scheme: light)"
        />
        <link
          rel="icon"
          href={SHAUGHV_ASSETS.faviconLight}
          media="(prefers-color-scheme: dark)"
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
