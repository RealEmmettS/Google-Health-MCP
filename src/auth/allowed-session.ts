import { isAllowedEmail } from "./allowlist";
import { auth } from "./auth";

/**
 * Resolves a Better Auth browser session and rechecks the current allowlist.
 * Session creation already fails closed, but this check also invalidates an
 * existing browser session immediately after its identity is removed.
 */
export async function getAllowedSession(requestHeaders: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session || !isAllowedEmail(session.user.email)) return null;
  return session;
}

/**
 * Distinguishes an unauthenticated request from a request carrying a valid but
 * now de-allowlisted session. Public auth/OAuth endpoints must remain usable
 * without a session, while a removed identity's existing cookie must not be.
 */
export async function hasDisallowedSession(requestHeaders: Headers) {
  const session = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  return Boolean(session && !isAllowedEmail(session.user.email));
}
