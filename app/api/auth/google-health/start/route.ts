import { NextResponse } from "next/server";
import { getAllowedSession } from "@/src/auth/allowed-session";
import { getOrCreateAppUser } from "@/src/auth/app-user";
import { appBaseUrl, buildHealthAuthorizeUrl } from "@/src/auth/google-health-oauth";
import { createOAuthState } from "@/src/auth/state";

export const runtime = "nodejs";

/**
 * Starts the Google Health consent flow (auth layer 3). Requires an
 * authenticated (allowlisted) better-auth session — this route is not
 * world-startable.
 */
export async function GET(request: Request) {
  const session = await getAllowedSession(request.headers);
  if (!session) {
    return NextResponse.redirect(new URL("/sign-in", appBaseUrl()));
  }

  const appUser = await getOrCreateAppUser(session.user.email, session.user.name);
  const state = await createOAuthState(appUser.id);
  return NextResponse.redirect(buildHealthAuthorizeUrl(state));
}
