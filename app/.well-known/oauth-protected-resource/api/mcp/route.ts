import { protectedResourceMetadataResponse } from "@/src/auth/protected-resource-metadata";

// Canonical RFC 9728 metadata for https://health.emmetts.dev/api/mcp.
export const runtime = "nodejs";
export const preferredRegion = "iad1";

export function GET(): Response {
  return protectedResourceMetadataResponse();
}

export const HEAD = GET;
