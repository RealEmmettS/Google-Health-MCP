import { oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { auth } from "@/src/auth/auth";
import { repairProtectedResourceMetadata } from "@/src/auth/mcp-oauth-compat";

// RFC 9728 protected-resource metadata: tells MCP clients which authorization
// server issues tokens for the /api/mcp resource.
export const runtime = "nodejs";

const protectedResource = oAuthProtectedResourceMetadata(auth);

export async function GET(request: Request): Promise<Response> {
  return repairProtectedResourceMetadata(await protectedResource(request));
}
