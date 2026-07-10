import { createElement } from "react";
import { SHAUGHV_ASSETS } from "../brand-assets";

export function BrandLockup({ label }: { label: string }) {
  const mark = createElement(
    "shaughv-mark",
    {
      className: "brand-mark-host",
      "aria-label": "SHAUGHV",
      style: {
        display: "block",
        width: "96px",
        height: "96px",
        color: "var(--fg)",
      },
    },
    <img
      className="brand-mark-fallback"
      src={SHAUGHV_ASSETS.wordmark}
      alt="SHAUGHV"
      width={96}
      height={96}
    />,
  );

  return (
    <div className="brand-lockup">
      {mark}
      <div className="brand-lockup-copy" aria-hidden="true">
        <span className="brand-lockup-name">SHAUGHV</span>
        <span className="brand-lockup-label">{label}</span>
      </div>
    </div>
  );
}

export function BrandLoader({ label }: { label: string }) {
  const loader = createElement("shaughv-loader", {
    className: "brand-loader-host",
    "aria-label": label,
    style: {
      display: "inline-flex",
      width: "148px",
      height: "80px",
      color: "var(--accent)",
    },
  });

  return (
    <div className="brand-loader" role="status" aria-live="polite">
      {loader}
      <span className="brand-loader-label">{label}</span>
    </div>
  );
}
