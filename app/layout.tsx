import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "shaughv-health-mcp",
  description:
    "Remote MCP server exposing Google Health / Fitbit data to trusted LLM clients",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          margin: 0,
          padding: "2rem",
          background: "#0d0d0d",
          color: "#f2f2f2",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
