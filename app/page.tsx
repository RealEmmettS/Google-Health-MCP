export default function Home() {
  return (
    <main style={{ maxWidth: 640 }}>
      <h1 style={{ letterSpacing: "0.05em" }}>SHAUGHV HEALTH MCP</h1>
      <p>
        Remote MCP server for Google Health / Fitbit data. Phase 0 scaffold —
        sign-in, connection dashboard, and the MCP endpoint arrive in later
        phases.
      </p>
      <p style={{ opacity: 0.6 }}>
        MCP endpoint (once live): <code>/api/mcp</code>
      </p>
    </main>
  );
}
