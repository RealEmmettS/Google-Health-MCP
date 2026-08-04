import Link from "next/link";
import { BrandLockup } from "../components/brand-elements";

export const metadata = {
  title: "Privacy — SHAUGHV Health MCP",
};

export default function PrivacyPage() {
  return (
    <main className="site-shell public-page privacy-page">
      <div className="public-frame">
        <BrandLockup label="Health / Privacy" />
        <article className="surface-panel privacy-copy">
          <div className="index-line">
            <span>Privacy / Single user</span>
            <span>Effective July 25, 2026</span>
          </div>
          <div className="section-heading section-heading-compact">
            <div>
              <p className="eyebrow">Private health adapter</p>
              <h1 className="connector-title">Your data stays scoped.</h1>
              <p className="section-description">
                This personal MCP is operated by Emmett Shaughnessy for Emmett
                alone. It is not a public health application and does not make
                medical diagnoses.
              </p>
            </div>
          </div>
          <div className="privacy-prose">
            <h2>What is stored</h2>
            <p>
              Google sign-in identity, Google Health consent status, encrypted
              OAuth tokens, explicit write audit records, persistent
              notification freshness metadata, and short-lived encrypted
              copies of exact Google Health API responses.
            </p>
            <h2>How it is used</h2>
            <p>
              Data is used only to answer authenticated MCP requests, perform
              explicit user-requested nutrition, hydration, or measurement
              writes, and report when Google says new data is available.
            </p>
            <h2>Retention and sharing</h2>
            <p>
              Cached health responses expire within their configured minutes
              and are physically cleaned up daily. Update pointers expire after
              seven days; webhook delivery records after 30 days. The server
              does not sell health data. Data returned to an authorized MCP
              client is then subject to that client&apos;s own terms and
              retention settings.
            </p>
            <h2>Control</h2>
            <p>
              A signed-in user can disconnect Google Health or permanently
              delete all Google Health domain data stored by this server from
              the account page. Those actions do not delete data held by
              Google, Fitbit, or an MCP client.
            </p>
            <Link href="/" className="button button-primary privacy-back-link">
              Return to account
            </Link>
          </div>
        </article>
      </div>
    </main>
  );
}
