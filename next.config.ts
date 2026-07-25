import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-centric app: MCP endpoint, OAuth routes, and a small status dashboard.
  // All API routes must run on the Node runtime (node:crypto, Postgres driver).
  // This Windows profile has another package-lock.json above the repo; pin
  // Turbopack's root so tracing/build warnings never select the user profile.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
