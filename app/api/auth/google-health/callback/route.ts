import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getOrCreateAppUser } from "@/src/auth/app-user";
import { auth } from "@/src/auth/auth";
import {
  appBaseUrl,
  exchangeCodeForTokens,
  fetchHealthIdentity,
} from "@/src/auth/google-health-oauth";
import { consumeOAuthState } from "@/src/auth/state";
import { saveTokens, upsertConnection } from "@/src/auth/token-store";
import { db } from "@/src/db/client";
import { appUsers } from "@/src/db/schema";
import { redactError } from "@/src/security/redact";

export const runtime = "nodejs";

function redirectHome(params: Record<string, string>): NextResponse {
  const url = new URL("/", appBaseUrl());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

/**
 * Google Health consent callback (handoff §12.3): validate single-use state,
 * exchange the code, store ENCRYPTED tokens, map Google Health identity,
 * mark the connection active.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirectHome({ health_error: "access_denied" });
  }
  if (!code || !state) {
    return redirectHome({ health_error: "missing_params" });
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.redirect(new URL("/sign-in", appBaseUrl()));
  }

  const stateRow = await consumeOAuthState(state);
  if (!stateRow) {
    return redirectHome({ health_error: "invalid_state" });
  }

  const appUser = await getOrCreateAppUser(session.user.email, session.user.name);
  if (stateRow.intendedUserId && stateRow.intendedUserId !== appUser.id) {
    return redirectHome({ health_error: "state_user_mismatch" });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const grantedScopes = tokens.scope?.split(" ").filter(Boolean) ?? [];

    const connection = await upsertConnection(appUser.id, grantedScopes);
    await saveTokens(connection.id, tokens);

    // Identity mapping is important (webhooks, troubleshooting) but not fatal
    // to the connection if it hiccups — the dashboard will show the gap.
    const identity = await fetchHealthIdentity(tokens.access_token);
    if (identity?.healthUserId || identity?.legacyUserId) {
      await db
        .update(appUsers)
        .set({
          googleHealthUserId: identity.healthUserId ?? null,
          legacyFitbitUserId: identity.legacyUserId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(appUsers.id, appUser.id));
    }

    return redirectHome({ health: "connected" });
  } catch (error) {
    console.error("google-health callback failed", redactError(error));
    return redirectHome({ health_error: "connect_failed" });
  }
}
