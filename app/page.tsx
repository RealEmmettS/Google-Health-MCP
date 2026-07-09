import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { getAppUserByEmail } from "@/src/auth/app-user";
import { auth } from "@/src/auth/auth";
import { getConnection } from "@/src/auth/token-store";
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
  tone: "ok" | "warn" | "amber";
}) {
  const color =
    tone === "ok" ? "#7fd8b4" : tone === "amber" ? "#f2d8a5" : "#f2b8b5";
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

const HEALTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google consent was cancelled — nothing was connected.",
  missing_params: "Google returned an incomplete callback. Try connecting again.",
  invalid_state: "The connect link expired or was already used. Try again.",
  state_user_mismatch: "This connect link belongs to a different signed-in user.",
  connect_failed: "Connecting to Google Health failed. Check server logs and retry.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  const params = await searchParams;

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

  const appUser = await getAppUserByEmail(session.user.email);
  const connection = appUser ? await getConnection(appUser.id) : null;
  const connected = connection?.status === "active";
  const reauthNeeded = connection?.status === "reauth_required";

  const healthBanner =
    params.health === "connected"
      ? "Google Health connected successfully."
      : null;
  const healthErrorKey = typeof params.health_error === "string" ? params.health_error : null;
  const healthError = healthErrorKey
    ? (HEALTH_ERROR_MESSAGES[healthErrorKey] ?? "Connecting to Google Health failed.")
    : null;

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
        {healthBanner ? <p style={{ color: "#7fd8b4" }}>{healthBanner}</p> : null}
        {healthError ? <p style={{ color: "#f2b8b5" }}>{healthError}</p> : null}
        <p>
          <StatusPill
            label={connected ? "Connected" : reauthNeeded ? "Reauth needed" : "Not connected"}
            tone={connected ? "ok" : reauthNeeded ? "amber" : "warn"}
          />
        </p>
        {connected ? (
          <p style={{ opacity: 0.8, fontSize: "0.9rem" }}>
            {connection?.scopes.length ?? 0} scopes granted
            {connection?.connectedAt
              ? ` · connected ${connection.connectedAt.toISOString().slice(0, 10)}`
              : ""}
            {appUser?.googleHealthUserId ? "" : " · identity mapping pending"}
          </p>
        ) : (
          <p style={{ opacity: 0.6, fontSize: "0.9rem" }}>
            {reauthNeeded
              ? "Google Health access expired or was revoked — reconnect to continue."
              : "Connect your Google Health account so MCP tools can read your Fitbit data."}
          </p>
        )}
        <p>
          <a href="/api/auth/google-health/start" style={buttonStyle}>
            {connected ? "Reconnect Google Health" : "Connect Google Health"}
          </a>
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
