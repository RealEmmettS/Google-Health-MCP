"use client";

import { useState } from "react";

export function PrivacyControls({ connected }: { connected: boolean }) {
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setStatus(undefined);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error("The request could not be completed.");
      window.location.href = "/";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The request failed.");
      setBusy(false);
    }
  }

  return (
    <div className="privacy-actions">
      <button
        type="button"
        className="button button-secondary"
        disabled={busy || !connected}
        onClick={() => {
          if (
            window.confirm(
              "Disconnect Google Health and remove cached data? Your Google Health account data will not be deleted.",
            )
          ) {
            void run("/api/privacy/disconnect");
          }
        }}
      >
        Disconnect Google Health
      </button>
      <button
        type="button"
        className="button button-danger"
        disabled={busy}
        onClick={() => {
          const confirmation = window.prompt(
            "This permanently deletes all Google Health data stored by this server. Type DELETE MY STORED HEALTH DATA to continue.",
          );
          if (confirmation === "DELETE MY STORED HEALTH DATA") {
            void run("/api/privacy/delete-health-data", { confirmation });
          }
        }}
      >
        Delete stored Health data
      </button>
      {status ? (
        <p className="inline-error" role="alert">
          {status}
        </p>
      ) : null}
    </div>
  );
}
