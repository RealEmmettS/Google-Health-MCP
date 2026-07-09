import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { auth } from "@/src/auth/auth";
import { SignOutButton } from "./components/sign-out-button";

const buttonStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.75rem 1.5rem",
  background: "#7fd8b4",
  color: "#0d0d0d",
  fontFamily: "inherit",
  fontWeight: 600,
  letterSpacing: "0.05em",
  textDecoration: "none",
  border: "1px solid #7fd8b4",
};

const sectionStyle: CSSProperties = {
  marginTop: "2.5rem",
  paddingTop: "1.5rem",
  borderTop: "1px solid #2a2a2a",
};

const codeBlockStyle: CSSProperties = {
  display: "block",
  padding: "0.75rem 1rem",
  background: "#161616",
  border: "1px solid #2a2a2a",
  color: "#f2f2f2",
  fontFamily: "inherit",
  fontSize: "0.9rem",
  overflowX: "auto",
  whiteSpace: "pre",
};

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn";
}) {
  const color = tone === "ok" ? "#7fd8b4" : "#f2b8b5";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.2rem 0.6rem",
        border: `1px solid ${color}`,
        color,
        fontSize: "0.75rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const mcpEndpoint = `${appUrl}/api/mcp`;

  if (!session) {
    return (
      <main style={{ maxWidth: 720 }}>
        <h1 style={{ letterSpacing: "0.05em" }}>SHAUGHV HEALTH MCP</h1>
        <p>
          Private MCP server exposing Emmett&apos;s Google Health / Fitbit
          data to trusted LLM assistants.
        </p>
        <p>
          <a href="/sign-in" style={buttonStyle}>
            Sign in with Google
          </a>
        </p>
        <p style={{ opacity: 0.6, fontSize: "0.9rem" }}>
          This server is allowlist-locked — only Emmett&apos;s Google account
          can sign in.
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ letterSpacing: "0.05em" }}>SHAUGHV HEALTH MCP</h1>

      <section>
        <p>
          Signed in as <strong>{session.user.email}</strong>
        </p>
        <SignOutButton />
      </section>

      <section style={sectionStyle}>
        <h2 style={{ letterSpacing: "0.05em", fontSize: "1rem" }}>
          Google Health connection
        </h2>
        <p>
          <StatusPill label="Not connected" tone="warn" />
        </p>
        <p style={{ opacity: 0.6, fontSize: "0.9rem" }}>
          The Google Health consent flow arrives in Phase 3.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ letterSpacing: "0.05em", fontSize: "1rem" }}>
          MCP endpoint
        </h2>
        <code style={codeBlockStyle}>{mcpEndpoint}</code>

        <p style={{ marginTop: "1.5rem", opacity: 0.8 }}>
          Client setup
        </p>
        <p>
          Claude Code:
          <br />
          <code style={codeBlockStyle}>
            claude mcp add --transport http health {mcpEndpoint}
          </code>
        </p>
        <p>
          claude.ai:
          <br />
          Settings → Connectors → Add custom connector →{" "}
          <code>{mcpEndpoint}</code>
        </p>
        <p>
          ChatGPT:
          <br />
          Settings → Connectors → Add custom connector (Dynamic Client
          Registration)
        </p>
      </section>
    </main>
  );
}
