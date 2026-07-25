import { Suspense } from "react";
import { headers } from "next/headers";
import { getAppUserByEmail } from "@/src/auth/app-user";
import { auth } from "@/src/auth/auth";
import { getConnection } from "@/src/auth/token-store";
import { BrandLoader, BrandLockup } from "./components/brand-elements";
import { CopyField } from "./components/copy-field";
import { GoogleSignInButton } from "./components/google-sign-in-button";
import { PrivacyControls } from "./components/privacy-controls";
import { SignOutButton } from "./components/sign-out-button";
import { SyncStatusDetails } from "./components/sync-status-details";

const HEALTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google consent was cancelled — nothing was connected.",
  missing_params: "Google returned an incomplete callback. Try connecting again.",
  invalid_state: "The connect link expired or was already used. Try again.",
  state_user_mismatch: "This connect link belongs to a different signed-in user.",
  connect_failed: "Connecting to Google Health failed. Check server logs and retry.",
};

function formatConnectedDate(value: Date | null | undefined): string {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "amber";
}) {
  return <span className={`status-pill status-pill-${tone}`}>{label}</span>;
}

function PublicHome() {
  return (
    <main className="site-shell public-page">
      <div className="public-frame">
        <BrandLockup label="Health / MCP" />

        <section className="hero-panel reveal-stage reveal-stage-one">
          <div className="index-line">
            <span>Private / Allowlist only</span>
            <span>Index 001</span>
          </div>

          <div className="hero-copy">
            <p className="eyebrow">SHAUGHV / Health MCP</p>
            <h1 className="hero-title">
              Health,
              <br />
              <span>connected.</span>
            </h1>
            <p className="hero-description">
              A private MCP bridge between approved Google Health accounts and
              trusted AI assistants.
            </p>
            <GoogleSignInButton callbackURL="/" label="Sign in with Google" />
            <p className="allowlist-note">
              Allowlist locked — only approved Google accounts can continue.
            </p>
            <p className="public-privacy-link">
              <a href="/privacy">Privacy and stored-data controls</a>
            </p>
          </div>

          <div className="signal-strip" aria-label="Service characteristics">
            <div>
              <span className="signal-label">Access</span>
              <strong>Private</strong>
            </div>
            <div>
              <span className="signal-label">Transport</span>
              <strong>OAuth 2.1</strong>
            </div>
            <div>
              <span className="signal-label">Source</span>
              <strong>Google Health</strong>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  const params = await searchParams;

  if (!session) return <PublicHome />;

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  const mcpEndpoint = `${appUrl}/api/mcp`;
  const codexCommand = `codex mcp add health --url ${mcpEndpoint}\ncodex mcp login health`;
  const claudeCommand = `claude mcp add --transport http health ${mcpEndpoint}`;

  const appUser = await getAppUserByEmail(session.user.email);
  const connection = appUser ? await getConnection(appUser.id) : null;
  const connected = connection?.status === "active";
  const reauthNeeded = connection?.status === "reauth_required";

  const connectionLabel = connected
    ? "Connected"
    : reauthNeeded
      ? "Reauth needed"
      : "Not connected";
  const connectionTone = connected ? "ok" : reauthNeeded ? "amber" : "warn";
  const connectionDescription = connected
    ? "The Google Health consent grant is active and ready for MCP calls."
    : reauthNeeded
      ? "Google Health access expired or was revoked — reconnect before using the tools."
      : "Connect once to authorize Google Health for this private MCP.";

  const healthBanner =
    params.health === "connected" ? "Google Health connected successfully." : null;
  const healthErrorKey =
    typeof params.health_error === "string" ? params.health_error : null;
  const healthError = healthErrorKey
    ? (HEALTH_ERROR_MESSAGES[healthErrorKey] ??
      "Connecting to Google Health failed.")
    : null;

  return (
    <main className="site-shell profile-page">
      <div className="profile-frame">
        <header className="profile-header reveal-stage reveal-stage-one">
          <BrandLockup label="MCP / Profile" />
          <div className="account-lockup">
            <div>
              <span className="account-label">Signed in as</span>
              <strong className="account-email">{session.user.email}</strong>
            </div>
            <SignOutButton />
          </div>
        </header>

        {healthBanner ? (
          <div className="notice notice-success" role="status">
            {healthBanner}
          </div>
        ) : null}
        {healthError ? (
          <div className="notice notice-error" role="alert">
            {healthError}
          </div>
        ) : null}

        <section className="surface-panel reveal-stage reveal-stage-two">
          <div className="index-line">
            <span>§ 01 / Google Health</span>
            <span>Connection control</span>
          </div>

          <div className="section-heading">
            <div>
              <p className="eyebrow">Connection control</p>
              <h1 className="profile-title">Google Health.</h1>
              <p className="section-description">{connectionDescription}</p>
            </div>
            <StatusPill label={connectionLabel} tone={connectionTone} />
          </div>

          <div className="status-grid">
            <div className="status-cell">
              <span className="status-label">Connection</span>
              <strong className="status-value">{connectionLabel}</strong>
              <span className="status-detail">
                {connection?.connectedAt
                  ? `Since ${formatConnectedDate(connection.connectedAt)}`
                  : "No consent grant recorded"}
              </span>
            </div>
            <div className="status-cell">
              <span className="status-label">Granted scopes</span>
              <strong className="status-value">{connection?.scopes.length ?? 0}</strong>
              <span className="status-detail">
                {appUser?.googleHealthUserId
                  ? "Identity mapping ready"
                  : "Identity mapping pending"}
              </span>
            </div>
            {connected && appUser ? (
              <Suspense
                fallback={
                  <div className="status-cell status-cell-loading status-cell-span-two">
                    <BrandLoader label="Checking sync status" />
                  </div>
                }
              >
                <SyncStatusDetails user={appUser} />
              </Suspense>
            ) : (
              <>
                <div className="status-cell">
                  <span className="status-label">Synced through</span>
                  <strong className="status-value">Not available</strong>
                  <span className="status-detail">Connect to load sync metadata</span>
                </div>
                <div className="status-cell">
                  <span className="status-label">Paired device</span>
                  <strong className="status-value">Not available</strong>
                  <span className="status-detail">Connect to load device metadata</span>
                </div>
              </>
            )}
          </div>

          <a
            href="/api/auth/google-health/start"
            className="button button-primary connect-button"
          >
            {connected
              ? "Reconnect Google Health"
              : reauthNeeded
                ? "Reconnect Google Health"
                : "Connect Google Health"}
          </a>
        </section>

        <section className="surface-panel reveal-stage reveal-stage-three">
          <div className="index-line">
            <span>§ 02 / Connector setup</span>
            <span>Manual access</span>
          </div>

          <div className="section-heading section-heading-compact">
            <div>
              <p className="eyebrow">Connect an agent</p>
              <h2 className="connector-title">One endpoint.</h2>
              <p className="section-description">
                Use the raw MCP URL directly or install it in a local client.
                Authentication continues in the browser.
              </p>
            </div>
          </div>

          <div className="connector-grid">
            <CopyField
              label="Raw MCP endpoint"
              value={mcpEndpoint}
              description="Streamable HTTP / OAuth 2.1"
              wide
            />
            <CopyField
              label="Codex CLI"
              value={codexCommand}
              description="Add the server, then complete OAuth"
            />
            <CopyField
              label="Claude Code"
              value={claudeCommand}
              description="Remote HTTP transport"
            />

            <div className="setup-card">
              <span className="setup-card-index">01 / Claude.ai</span>
              <h3>Custom connector</h3>
              <p>
                Open Settings / Connectors / Add custom connector, paste the raw
                MCP endpoint, then complete OAuth.
              </p>
            </div>
            <div className="setup-card">
              <span className="setup-card-index">02 / ChatGPT</span>
              <h3>Custom connector</h3>
              <p>
                Create a custom connector with the raw endpoint. Dynamic Client
                Registration and OAuth are handled by this server.
              </p>
            </div>
          </div>

          <p className="connector-footnote">
            Private by design — connector registration is open, but only an
            allowlisted Google account can authorize access.
          </p>
        </section>

        <section className="surface-panel reveal-stage reveal-stage-three">
          <div className="index-line">
            <span>§ 03 / Privacy</span>
            <span>Stored-data control</span>
          </div>
          <div className="section-heading section-heading-compact">
            <div>
              <p className="eyebrow">Your data</p>
              <h2 className="connector-title">Keep or remove it.</h2>
              <p className="section-description">
                Disconnecting revokes the Google grant when possible and
                removes connection-derived local data. Full deletion also
                removes local write audits and your Google Health domain
                profile. Neither action deletes data held by Google or Fitbit.
              </p>
              <p className="privacy-policy-link">
                <a href="/privacy">Read the privacy and retention disclosure</a>
              </p>
            </div>
          </div>
          <PrivacyControls connected={connected} />
        </section>
      </div>
    </main>
  );
}
