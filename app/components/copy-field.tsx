"use client";

import { useEffect, useRef, useState } from "react";

export interface CopyFieldProps {
  label: string;
  value: string;
  description?: string;
  wide?: boolean;
}

type CopyState = "idle" | "copied" | "failed";

function fallbackCopy(value: string): boolean {
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  return copied;
}

export function CopyField({
  label,
  value,
  description,
  wide = false,
}: CopyFieldProps) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyValue() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else if (!fallbackCopy(value)) {
        throw new Error("Clipboard unavailable");
      }
      setState("copied");
    } catch {
      try {
        if (!fallbackCopy(value)) throw new Error("Clipboard unavailable");
        setState("copied");
      } catch {
        setState("failed");
      }
    }

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 2200);
  }

  const buttonLabel =
    state === "copied" ? "Copied" : state === "failed" ? "Retry" : "Copy";

  return (
    <div className={`copy-field${wide ? " copy-field-wide" : ""}`}>
      <div className="copy-field-header">
        <div>
          <p className="copy-field-label">{label}</p>
          {description ? (
            <p className="copy-field-description">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="copy-button"
          onClick={copyValue}
          aria-label={`Copy ${label}`}
        >
          {buttonLabel}
        </button>
      </div>
      <pre className="copy-field-value" tabIndex={0}>
        <code>{value}</code>
      </pre>
      <span className="sr-only" aria-live="polite">
        {state === "copied"
          ? `${label} copied to clipboard.`
          : state === "failed"
            ? `Could not copy ${label}. Select the text manually.`
            : ""}
      </span>
    </div>
  );
}
