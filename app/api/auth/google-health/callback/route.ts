import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getAllowedSession } from "@/src/auth/allowed-session";
import { getOrCreateAppUser } from "@/src/auth/app-user";
import {
  appBaseUrl,
  exchangeCodeForTokens,
  fetchHealthIdentity,
} from "@/src/auth/google-health-oauth";
import { prepareGoogleHealthDpopKey } from "@/src/auth/google-health-dpop";
import { consumeOAuthState } from "@/src/auth/state";
import {
  commitDpopCredentialReplacement,
  getConnection,
} from "@/src/auth/token-store";
import { db } from "@/src/db/client";
import { appUsers } from "@/src/db/schema";
import { redactError } from "@/src/security/redact";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

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

  const session = await getAllowedSession(request.headers);
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
    const existingConnection = await getConnection(appUser.id);
    const connectionId = existingConnection?.id ?? randomUUID();
    const dpopKey = await prepareGoogleHealthDpopKey(connectionId);
    // A nonce challenge is retried in memory. Nothing is persisted until the
    // DPoP-bound replacement refresh token has been returned successfully, so
    // a rejected Health-specific exchange cannot damage the working token.
    const tokens = await exchangeCodeForTokens(code, {
      material: dpopKey.material,
    });
    const grantedScopes = tokens.scope?.split(" ").filter(Boolean) ?? [];
    await commitDpopCredentialReplacement({
      appUserId: appUser.id,
      connectionId,
      dpopKey,
      grantedScopes,
      tokens,
    });

    // Identity mapping is important (webhooks, troubleshooting) but not fatal
    // to the connection if it hiccups — the dashboard will show the gap.
    try {
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
    } catch (error) {
      // Credential replacement already committed. Identity is diagnostic
      // metadata, so preserve the successful connection and log safely.
      console.warn("google-health identity mapping deferred", redactError(error));
    }

    return redirectHome({ health: "connected" });
  } catch (error) {
    console.error("google-health callback failed", redactError(error));
    return redirectHome({ health_error: "connect_failed" });
  }
}
