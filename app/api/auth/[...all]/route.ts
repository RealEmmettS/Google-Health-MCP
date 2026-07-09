import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/src/auth/auth";

// better-auth handler: Google sign-in, session management, and the MCP
// plugin's OAuth 2.1 authorization-server endpoints (authorize, token,
// dynamic client registration).
export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth);
