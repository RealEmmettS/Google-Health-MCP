import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { auth } from "@/src/auth/auth";

// RFC 8414 authorization-server metadata. MCP clients (claude.ai, ChatGPT,
// Claude Code) discover the authorize/token/register endpoints here.
export const runtime = "nodejs";

export const GET = oAuthDiscoveryMetadata(auth);
