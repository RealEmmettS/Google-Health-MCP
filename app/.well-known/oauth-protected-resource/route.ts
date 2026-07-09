import { oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { auth } from "@/src/auth/auth";

// RFC 9728 protected-resource metadata: tells MCP clients which authorization
// server issues tokens for the /api/mcp resource.
export const runtime = "nodejs";

export const GET = oAuthProtectedResourceMetadata(auth);
