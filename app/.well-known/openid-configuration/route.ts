import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { auth } from "@/src/auth/auth";
import { repairAuthorizationServerMetadata } from "@/src/auth/mcp-oauth-compat";

// OIDC discovery for strict clients that validate the ID token separately
// from the RFC 8414 metadata used by MCP authorization discovery.
export const runtime = "nodejs";

const discovery = oAuthDiscoveryMetadata(auth);

export async function GET(request: Request): Promise<Response> {
  return repairAuthorizationServerMetadata(await discovery(request));
}
