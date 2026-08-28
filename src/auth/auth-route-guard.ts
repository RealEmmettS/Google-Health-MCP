import { hasDisallowedSession } from "./allowed-session";

const SIGN_OUT_PATH = "/api/auth/sign-out";

/**
 * Blocks a removed identity from reusing a previously issued browser session
 * across Better Auth and OAuth-provider endpoints. Sign-out stays reachable so
 * the stale cookie can still be cleared.
 */
export async function rejectDisallowedAuthSession(
  request: Request,
): Promise<Response | null> {
  if (new URL(request.url).pathname === SIGN_OUT_PATH) return null;
  if (!(await hasDisallowedSession(request.headers))) return null;

  return Response.json(
    { error: "forbidden" },
    {
      status: 403,
      headers: {
        "cache-control": "private, no-store",
        pragma: "no-cache",
      },
    },
  );
}
