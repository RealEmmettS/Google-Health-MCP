/**
 * Phase 7 live E2E: prove the full OAuth 2.1 + MCP path end-to-end,
 * headlessly. The target defaults to localhost; non-local runs require an
 * explicit mutation opt-in.
 *
 * Real client paths (what claude.ai / ChatGPT / Claude Code actually do):
 *   1. read /.well-known/oauth-authorization-server
 *   2. DCR register both a confidential hosted client and a public client
 *   3. PKCE /authorize  (Google login is the only un-automatable step; we
 *      satisfy it by minting a better-auth session row + signing its cookie
 *      exactly as the server would — same HMAC scheme and cookie naming)
 *   4. form-encoded /token exchange  → access_token
 *   5. POST /api/mcp with each Bearer token → initialize + tools/list
 *   6. run representative tools through the confidential-client token
 *
 * The script intentionally has no direct-token fallback: an OAuth failure must
 * remain visible. Every session, verification code, DCR client, consent, and
 * token created by this run is deleted in a finally block and verified absent.
 *
 * Usage: npx tsx scripts/live-verify-e2e.ts [baseUrl] [email]
 *        [--allow-production-mutations]
 */
import { createHmac, randomBytes, createHash, randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { redactError } from "../src/security/redact";

config({ path: ".env.development.local", quiet: true });

const MUTATION_OPT_IN = "--allow-production-mutations";
const cliArgs = process.argv.slice(2);
const allowProductionMutations = cliArgs.includes(MUTATION_OPT_IN);
const positionalArgs = cliArgs.filter((arg) => arg !== MUTATION_OPT_IN);
const BASE = (positionalArgs[0] ?? "http://localhost:3000").replace(/\/+$/, "");
const EMAIL = positionalArgs[1] ?? "eshaughv@gmail.com";
const RESOURCE = `${BASE}/api/mcp`;
const REDIRECT_URI = "http://localhost:9876/callback";
const SECRET = process.env.BETTER_AUTH_SECRET ?? "";
const REQUESTED_SCOPE = "openid profile email offline_access";
const DCR_OPTIONAL_FIELDS = [
  "client_uri",
  "logo_uri",
  "scope",
  "contacts",
  "tos_uri",
  "policy_uri",
  "jwks_uri",
  "jwks",
  "software_id",
  "software_version",
  "software_statement",
  "metadata",
  "registration_access_token",
  "registration_client_uri",
] as const;

type JsonObject = Record<string, unknown>;
type AuthMethod = "client_secret_post" | "none";

interface OAuthScenario {
  label: string;
  clientName: string;
  authMethod: AuthMethod;
}

interface OAuthResult {
  accessToken: string;
  clientId: string;
  label: string;
}

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures += 1;
};

function requireMutationOptInForNonLocalTarget(): void {
  const hostname = new URL(BASE).hostname.toLowerCase();
  const isLocal =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
  if (!isLocal && !allowProductionMutations) {
    throw new Error(
      `Refusing DB/OAuth mutations against non-local target ${BASE}. ` +
        `Re-run with ${MUTATION_OPT_IN} only after confirming the target.`,
    );
  }
}

function checkNoStoreHeaders(label: string, response: Response): void {
  const cacheControl = response.headers.get("cache-control") ?? "";
  const pragma = response.headers.get("pragma") ?? "";
  check(
    `${label}: response forbids caching`,
    /\bno-store\b/i.test(cacheControl) && /\bno-cache\b/i.test(pragma),
    `cache-control=${cacheControl || "missing"} pragma=${pragma || "missing"}`,
  );
}

// --- better-call signed-cookie scheme (verified from source) -----------------
// signCookieValue(v) = encodeURIComponent(`${v}.${base64(HMAC_SHA256(v, secret))}`)
function signCookie(value: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(value).digest("base64");
  return encodeURIComponent(`${value}.${sig}`);
}
const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// --- streamable-HTTP JSON-RPC helpers (mirror the passing spike test) --------
async function parseRpc(res: Response): Promise<any> {
  const text = await res.text();
  if (text.trimStart().startsWith("{")) return JSON.parse(text);
  const data = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  if (!data.length) throw new Error(`no JSON-RPC in response: ${text.slice(0, 200)}`);
  return JSON.parse(data[data.length - 1]);
}

async function mcpCall(
  token: string,
  body: unknown,
  sessionId?: string,
): Promise<{ json: any; sessionId: string | null; status: number }> {
  const res = await fetch(RESOURCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    json: await parseRpc(res),
    sessionId: res.headers.get("mcp-session-id"),
    status: res.status,
  };
}

async function mcpNotify(token: string, body: unknown, sessionId: string): Promise<number> {
  const res = await fetch(RESOURCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify(body),
  });
  await res.body?.cancel();
  return res.status;
}

async function main() {
  requireMutationOptInForNonLocalTarget();

  const { db } = await import("../src/db/client");
  const { sql } = await import("drizzle-orm");

  const runId = randomUUID();
  const sessionRowId = randomUUID();
  const sessionToken = randomUUID().replace(/-/g, "") + randomBytes(8).toString("hex");
  const clientNames = new Set<string>();
  const clientIds = new Set<string>();
  const verificationCodes = new Set<string>();

  const countRows = (result: { rows?: unknown[] }): number => {
    const row = result.rows?.[0] as { count?: number | string } | undefined;
    return Number(row?.count ?? 0);
  };

  const cleanupArtifacts = async () => {
    const cleanupErrors: string[] = [];
    const safely = async (label: string, operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch {
        cleanupErrors.push(label);
      }
    };

    // Recover client ids by the run-unique names as well as by DCR responses.
    // This still permits cleanup if registration committed but its response was
    // malformed or the network failed before the body reached this process.
    for (const clientName of clientNames) {
      try {
        const result = await db.execute(
          sql`select "client_id" from "oauth_application" where "name" = ${clientName}`,
        );
        for (const row of result.rows ?? []) {
          const clientId = (row as { client_id?: string }).client_id;
          if (clientId) clientIds.add(clientId);
        }
      } catch {
        cleanupErrors.push(`discover client ${clientName}`);
      }
    }

    for (const code of verificationCodes) {
      await safely("verification code", () =>
        db.execute(sql`delete from "verification" where "identifier" = ${code}`),
      );
    }
    for (const clientId of clientIds) {
      const verificationPattern = `%\"clientId\":\"${clientId}\"%`;
      await safely("client verification code", () =>
        db.execute(sql`delete from "verification" where "value" like ${verificationPattern}`),
      );
      await safely("client access tokens", () =>
        db.execute(sql`delete from "oauth_access_token" where "client_id" = ${clientId}`),
      );
      await safely("client consents", () =>
        db.execute(sql`delete from "oauth_consent" where "client_id" = ${clientId}`),
      );
      await safely("DCR client id", () =>
        db.execute(sql`delete from "oauth_application" where "client_id" = ${clientId}`),
      );
    }
    for (const clientName of clientNames) {
      await safely("DCR client name", () =>
        db.execute(sql`delete from "oauth_application" where "name" = ${clientName}`),
      );
    }
    await safely("forged session", () =>
      db.execute(sql`delete from "session" where "id" = ${sessionRowId}`),
    );

    let remaining = 0;
    for (const clientName of clientNames) {
      try {
        remaining += countRows(
          await db.execute(
            sql`select count(*)::int as "count" from "oauth_application" where "name" = ${clientName}`,
          ),
        );
      } catch {
        cleanupErrors.push(`verify client ${clientName}`);
      }
    }
    for (const clientId of clientIds) {
      const verificationPattern = `%\"clientId\":\"${clientId}\"%`;
      try {
        remaining += countRows(
          await db.execute(
            sql`select count(*)::int as "count" from "oauth_access_token" where "client_id" = ${clientId}`,
          ),
        );
        remaining += countRows(
          await db.execute(
            sql`select count(*)::int as "count" from "oauth_consent" where "client_id" = ${clientId}`,
          ),
        );
        remaining += countRows(
          await db.execute(
            sql`select count(*)::int as "count" from "verification" where "value" like ${verificationPattern}`,
          ),
        );
      } catch {
        cleanupErrors.push("verify client-owned rows");
      }
    }
    for (const code of verificationCodes) {
      try {
        remaining += countRows(
          await db.execute(
            sql`select count(*)::int as "count" from "verification" where "identifier" = ${code}`,
          ),
        );
      } catch {
        cleanupErrors.push("verify authorization code");
      }
    }
    try {
      remaining += countRows(
        await db.execute(
          sql`select count(*)::int as "count" from "session" where "id" = ${sessionRowId}`,
        ),
      );
    } catch {
      cleanupErrors.push("verify session");
    }

    check(
      "cleanup removed every row created by this run",
      cleanupErrors.length === 0 && remaining === 0,
      `remaining=${remaining} cleanupErrors=${cleanupErrors.join(",") || "none"}`,
    );
  };

  console.log(`\n=== Phase 7 E2E against ${BASE} (user ${EMAIL}) ===\n`);

  try {
    // 0) Negative check: unauthenticated /api/mcp must advertise discovery.
    {
      const res = await fetch(RESOURCE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }),
      });
      check(
        "unauthenticated /api/mcp → 401 + WWW-Authenticate",
        res.status === 401 && !!res.headers.get("www-authenticate"),
        `status=${res.status} wwwauth=${res.headers.get("www-authenticate") ?? "none"}`,
      );
    }

    // 1) Discovery metadata (the clients' entrypoint).
    const meta = (await fetch(`${BASE}/.well-known/oauth-authorization-server`).then((r) =>
      r.json(),
    )) as JsonObject;
    const authorizationEndpoint = String(meta.authorization_endpoint ?? "");
    const tokenEndpoint = String(meta.token_endpoint ?? "");
    const registrationEndpoint = String(meta.registration_endpoint ?? "");
    const userinfoEndpoint = String(meta.userinfo_endpoint ?? "");
    const jwksUri = String(meta.jwks_uri ?? "");
    const advertisedIdTokenAlgs = Array.isArray(meta.id_token_signing_alg_values_supported)
      ? meta.id_token_signing_alg_values_supported.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    check(
      "AS metadata: issuer + all advertised endpoints present",
      meta.issuer === BASE &&
        !!authorizationEndpoint &&
        !!tokenEndpoint &&
        !!registrationEndpoint &&
        !!userinfoEndpoint &&
        !!jwksUri,
      `issuer=${String(meta.issuer ?? "missing")}`,
    );
    check(
      "AS metadata advertises at least one ID-token signing algorithm",
      advertisedIdTokenAlgs.length > 0,
      `algs=${advertisedIdTokenAlgs.join(",") || "none"}`,
    );

    if (jwksUri) {
      const jwksRes = await fetch(jwksUri, { headers: { Accept: "application/json" } });
      const jwks = (await jwksRes.json().catch(() => ({}))) as JsonObject;
      check(
        "advertised jwks_uri resolves to a JWKS",
        jwksRes.ok && Array.isArray(jwks.keys),
        `status=${jwksRes.status} keys=${Array.isArray(jwks.keys) ? jwks.keys.length : "missing"}`,
      );
    }
    if (!jwksUri) throw new Error("authorization-server metadata is missing jwks_uri");
    const remoteJwks = createRemoteJWKSet(new URL(jwksUri));

    const oidcMetadata = (await fetch(`${BASE}/.well-known/openid-configuration`).then((r) =>
      r.json(),
    )) as JsonObject;
    check(
      "OIDC discovery matches the OAuth issuer and JWKS",
      oidcMetadata.issuer === meta.issuer && oidcMetadata.jwks_uri === meta.jwks_uri,
      `issuer=${oidcMetadata.issuer === meta.issuer ? "ok" : "invalid"} jwks=${oidcMetadata.jwks_uri === meta.jwks_uri ? "ok" : "invalid"}`,
    );

    check("BETTER_AUTH_SECRET is loaded for signed session cookie", SECRET.length > 0);
    if (!SECRET) throw new Error("BETTER_AUTH_SECRET is required for the live OAuth path");

    // Resolve the better-auth user id (what the access token is keyed to).
    const userRow = (
      await db.execute(
        sql`select id, email, name from "user" where lower(email) = lower(${EMAIL}) limit 1`,
      )
    ).rows?.[0] as { id?: string } | undefined;
    if (!userRow?.id) {
      throw new Error(`no better-auth user row for ${EMAIL} — has the allowlisted user signed in?`);
    }
    const betterAuthUserId = userRow.id;

    // Establish a logged-in session once. Using the database clock makes the
    // row valid with both timestamp and timestamptz schemas.
    await db.execute(sql`
      insert into "session" ("id","expires_at","token","created_at","updated_at","user_id")
      values (${sessionRowId}, now() + interval '1 hour', ${sessionToken}, now(), now(), ${betterAuthUserId})
    `);
    const cookieName = `${BASE.startsWith("https://") ? "__Secure-" : ""}better-auth.session_token`;
    const cookieHeader = `${cookieName}=${signCookie(sessionToken, SECRET)}`;

    const runOAuthScenario = async (scenario: OAuthScenario): Promise<OAuthResult | null> => {
      clientNames.add(scenario.clientName);

      // DCR: client_secret_post mirrors the hosted connector; none mirrors a
      // public Claude Code client and must never receive a client secret.
      const registrationRes = await fetch(registrationEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_name: scenario.clientName,
          redirect_uris: [REDIRECT_URI],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: scenario.authMethod,
        }),
      });
      checkNoStoreHeaders(`${scenario.label}: DCR`, registrationRes);
      const registration = (await registrationRes.json().catch(() => ({}))) as JsonObject;
      const clientId = typeof registration.client_id === "string" ? registration.client_id : "";
      const clientSecret =
        typeof registration.client_secret === "string" ? registration.client_secret : "";
      if (clientId) clientIds.add(clientId);
      check(
        `${scenario.label}: DCR returns the requested client type`,
        registrationRes.status === 201 &&
          !!clientId &&
          registration.token_endpoint_auth_method === scenario.authMethod,
        `status=${registrationRes.status} client_id=${clientId ? "yes" : "no"}`,
      );

      const unexpectedOptionalFields = DCR_OPTIONAL_FIELDS.filter((field) =>
        Object.prototype.hasOwnProperty.call(registration, field),
      );
      check(
        `${scenario.label}: unrequested RFC DCR fields are omitted, not null`,
        unexpectedOptionalFields.length === 0,
        `unexpected=${unexpectedOptionalFields.join(",") || "none"}`,
      );
      if (scenario.authMethod === "none") {
        check(
          `${scenario.label}: public DCR response omits client-secret fields`,
          !Object.prototype.hasOwnProperty.call(registration, "client_secret") &&
            !Object.prototype.hasOwnProperty.call(registration, "client_secret_expires_at"),
        );
      } else {
        check(
          `${scenario.label}: confidential DCR response includes a non-expiring client secret`,
          !!clientSecret && registration.client_secret_expires_at === 0,
        );
      }
      if (!clientId) return null;

      const codeVerifier = b64url(randomBytes(32));
      const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());
      const state = randomUUID();
      const nonce = randomUUID();
      const authorizeParams = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: REQUESTED_SCOPE,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        resource: RESOURCE,
      });
      const authorizeUrl = `${authorizationEndpoint}?${authorizeParams.toString()}`;

      // Exercise the browser's signed-out branch and verify the sign-in page
      // receives every value required to reconstruct the authorize URL.
      const signedOutRes = await fetch(authorizeUrl, { redirect: "manual" });
      const signInLocation = signedOutRes.headers.get("location") ?? "";
      const signInUrl = signInLocation ? new URL(signInLocation, BASE) : null;
      const mismatchedAuthorizeParams = Array.from(authorizeParams.entries())
        .filter(([key, value]) => signInUrl?.searchParams.get(key) !== value)
        .map(([key]) => key);
      check(
        `${scenario.label}: signed-out authorize redirects to /sign-in with the exact query`,
        !!signInUrl &&
          signInUrl.origin === new URL(BASE).origin &&
          signInUrl.pathname === "/sign-in" &&
          mismatchedAuthorizeParams.length === 0,
        `status=${signedOutRes.status} mismatched=${mismatchedAuthorizeParams.join(",") || "none"}`,
      );
      check(
        `${scenario.label}: signed-out authorize stores its resumable prompt cookie`,
        (signedOutRes.headers.get("set-cookie") ?? "").includes("oidc_login_prompt="),
      );

      // Exercise the same authorize request with the forged signed session.
      const authorizationRes = await fetch(authorizeUrl, {
        headers: { cookie: cookieHeader },
        redirect: "manual",
      });
      const callbackLocation = authorizationRes.headers.get("location") ?? "";
      const callbackUrl = callbackLocation ? new URL(callbackLocation, BASE) : null;
      const code = callbackUrl?.searchParams.get("code") ?? "";
      if (code) verificationCodes.add(code);
      const gotCode =
        !!callbackUrl &&
        `${callbackUrl.origin}${callbackUrl.pathname}` === REDIRECT_URI &&
        callbackUrl.searchParams.get("state") === state &&
        !!code;
      check(
        `${scenario.label}: authorize issues a code and preserves state`,
        gotCode,
        gotCode
          ? "code issued"
          : `status=${authorizationRes.status} location=${callbackLocation ? "unexpected" : "missing"}`,
      );
      if (!gotCode) return null;

      // FORM-ENCODED is required for connector compatibility. First prove
      // malformed requests are rejected before the one-time code is consumed;
      // the successful exchange below then proves that the same code survived.
      const tokenRequestBase = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        resource: RESOURCE,
        ...(scenario.authMethod === "client_secret_post" ? { client_secret: clientSecret } : {}),
      });

      const missingPkceRes = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: tokenRequestBase.toString(),
      });
      const missingPkceError = (await missingPkceRes.json().catch(() => ({}))) as JsonObject;
      check(
        `${scenario.label}: token exchange rejects missing PKCE`,
        missingPkceRes.status === 400 && missingPkceError.error === "invalid_request",
        `status=${missingPkceRes.status} error=${String(missingPkceError.error ?? "missing")}`,
      );

      const wrongResourceForm = new URLSearchParams(tokenRequestBase);
      wrongResourceForm.set("code_verifier", codeVerifier);
      wrongResourceForm.set("resource", `${BASE}/not-the-mcp-resource`);
      const wrongResourceRes = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: wrongResourceForm.toString(),
      });
      const wrongResourceError = (await wrongResourceRes.json().catch(() => ({}))) as JsonObject;
      check(
        `${scenario.label}: token exchange rejects a non-canonical resource`,
        wrongResourceRes.status === 400 && wrongResourceError.error === "invalid_target",
        `status=${wrongResourceRes.status} error=${String(wrongResourceError.error ?? "missing")}`,
      );

      // Public clients send client_id + PKCE only; confidential clients also
      // prove their client secret in the request body.
      const tokenForm = new URLSearchParams(tokenRequestBase);
      tokenForm.set("code_verifier", codeVerifier);
      const tokenRes = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: tokenForm.toString(),
      });
      checkNoStoreHeaders(`${scenario.label}: token`, tokenRes);
      const token = (await tokenRes.json().catch(() => ({}))) as JsonObject;
      const accessToken = typeof token.access_token === "string" ? token.access_token : "";
      const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
      const tokenScope = typeof token.scope === "string" ? token.scope.split(" ") : [];
      check(
        `${scenario.label}: form-encoded token exchange returns a Bearer access token`,
        tokenRes.ok && accessToken.length > 0 && String(token.token_type).toLowerCase() === "bearer",
        `status=${tokenRes.status} keys=${Object.keys(token).join(",")}`,
      );
      check(
        `${scenario.label}: rejected PKCE/resource attempts do not consume the authorization code`,
        tokenRes.ok && accessToken.length > 0,
        `final_status=${tokenRes.status}`,
      );
      check(
        `${scenario.label}: token response includes expiry, refresh, and all requested scopes`,
        typeof token.expires_in === "number" &&
          token.expires_in > 0 &&
          refreshToken.length > 0 &&
          REQUESTED_SCOPE.split(" ").every((scope) => tokenScope.includes(scope)),
        `expires_in=${String(token.expires_in ?? "missing")} refresh=${refreshToken ? "yes" : "no"}`,
      );

      const idToken = typeof token.id_token === "string" ? token.id_token : "";
      let idTokenClaims: JWTPayload | null = null;
      let idTokenAlg = "";
      try {
        const verified = await jwtVerify(idToken, remoteJwks, {
          algorithms: ["RS256"],
          issuer: BASE,
          audience: clientId,
          subject: betterAuthUserId,
        });
        idTokenClaims = verified.payload;
        idTokenAlg = verified.protectedHeader.alg;
        check(
          `${scenario.label}: ID token cryptographically verifies against advertised JWKS`,
          idTokenAlg === "RS256" && advertisedIdTokenAlgs.includes(idTokenAlg),
          `alg=${idTokenAlg} advertised=${advertisedIdTokenAlgs.join(",") || "none"}`,
        );
      } catch (error) {
        check(
          `${scenario.label}: ID token cryptographically verifies against advertised JWKS`,
          false,
          redactError(error).message.slice(0, 160),
        );
      }

      const audience = idTokenClaims?.aud;
      const audienceMatches =
        audience === clientId || (Array.isArray(audience) && audience.includes(clientId));
      check(
        `${scenario.label}: verified ID token binds issuer, audience, subject, and nonce`,
        idTokenClaims?.iss === BASE &&
          audienceMatches &&
          idTokenClaims?.sub === betterAuthUserId &&
          idTokenClaims?.nonce === nonce,
        `iss=${idTokenClaims?.iss === BASE ? "ok" : "invalid"} aud=${audienceMatches ? "ok" : "invalid"} sub=${idTokenClaims?.sub === betterAuthUserId ? "ok" : "invalid"} nonce=${idTokenClaims?.nonce === nonce ? "ok" : "invalid"}`,
      );

      const nowSeconds = Math.floor(Date.now() / 1000);
      const issuedAt = Number(idTokenClaims?.iat);
      const expiresAt = Number(idTokenClaims?.exp);
      const authTime = Number(idTokenClaims?.auth_time);
      const hasAuthTime = idTokenClaims?.auth_time !== undefined;
      const authTimeIsValid =
        !hasAuthTime ||
        (Number.isInteger(authTime) &&
          authTime > nowSeconds - 7200 &&
          authTime <= nowSeconds + 60);
      check(
        `${scenario.label}: verified ID token carries valid NumericDate claims`,
        Number.isInteger(issuedAt) &&
          Number.isInteger(expiresAt) &&
          issuedAt > nowSeconds - 300 &&
          issuedAt <= nowSeconds + 60 &&
          expiresAt > nowSeconds &&
          expiresAt > issuedAt &&
          expiresAt <= nowSeconds + 7200 &&
          authTimeIsValid,
        `iat=${Number.isInteger(issuedAt) ? "integer" : "invalid"} exp=${Number.isInteger(expiresAt) ? "integer" : "invalid"} auth_time=${hasAuthTime ? (Number.isInteger(authTime) ? "integer" : "invalid") : "omitted"}`,
      );

      return accessToken ? { accessToken, clientId, label: scenario.label } : null;
    };

    const exerciseMcp = async (result: OAuthResult) => {
      const init = await mcpCall(result.accessToken, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "e2e", version: "0.0.0" },
        },
      });
      const initOk =
        init.status >= 200 &&
        init.status < 300 &&
        init.json?.result?.serverInfo?.name === "shaughv-health-mcp";
      check(
        `${result.label}: fresh Bearer initialize succeeds immediately`,
        initOk,
        `status=${init.status} name=${init.json?.result?.serverInfo?.name ?? "missing"}`,
      );

      const mcpSession = init.sessionId ?? undefined;
      if (initOk && mcpSession) {
        const notifyStatus = await mcpNotify(
          result.accessToken,
          { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
          mcpSession,
        );
        check(
          `${result.label}: initialized notification accepted`,
          notifyStatus >= 200 && notifyStatus < 300,
          `status=${notifyStatus}`,
        );
      }

      const list = await mcpCall(
        result.accessToken,
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        mcpSession,
      );
      const tools: Array<{ name: string }> = list.json?.result?.tools ?? [];
      const names = tools.map((tool) => tool.name);
      const listOk = list.status >= 200 && list.status < 300 && names.length >= 15;
      check(
        `${result.label}: fresh Bearer tools/list returns the full surface`,
        listOk,
        `status=${list.status} tools=${names.length}`,
      );
      check(
        `${result.label}: read + write tools present; forbidden writes absent`,
        names.includes("get_today_steps") &&
          names.includes("create_nutrition_log") &&
          !names.some((name) =>
            /write.*(sleep|exercise|setting)|update_(sleep|exercise|setting)/.test(name),
          ),
      );
      return { ready: initOk && listOk, mcpSession };
    };

    const assertPersistedExpiry = async (result: OAuthResult) => {
      const row = (
        await db.execute(sql`
          select "access_token_expires_at" > now() as "is_future"
          from "oauth_access_token"
          where "client_id" = ${result.clientId}
          order by "created_at" desc
          limit 1
        `)
      ).rows?.[0] as { is_future?: boolean } | undefined;
      check(
        `${result.label}: persisted access-token expiry is still in the future`,
        row?.is_future === true,
        `is_future=${String(row?.is_future ?? "missing")}`,
      );
    };

    const exerciseUserInfo = async (result: OAuthResult) => {
      if (!userinfoEndpoint) return;
      const response = await fetch(userinfoEndpoint, {
        headers: { Authorization: `Bearer ${result.accessToken}`, Accept: "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as JsonObject;
      check(
        `${result.label}: advertised userinfo_endpoint resolves for its Bearer token`,
        response.ok && typeof body.sub === "string",
        `status=${response.status} sub=${typeof body.sub === "string" ? "yes" : "no"}`,
      );
    };

    const exerciseConfidentialTools = async (
      result: OAuthResult,
      mcpSession: string | undefined,
    ) => {
      const ping = await mcpCall(
        result.accessToken,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "ping", arguments: { echo: "e2e" } },
        },
        mcpSession,
      );
      const pingPayload = JSON.parse(ping.json?.result?.content?.[0]?.text ?? "{}");
      check(
        "confidential client: ping authenticates as the token's user",
        pingPayload.pong === true && pingPayload.authenticatedUserId === betterAuthUserId,
        `authedUserId=${pingPayload.authenticatedUserId ?? "missing"}`,
      );

      const status = await mcpCall(
        result.accessToken,
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "get_sync_status", arguments: {} },
        },
        mcpSession,
      );
      const statusPayload = JSON.parse(status.json?.result?.content?.[0]?.text ?? "{}");
      check(
        "confidential client: get_sync_status reports granted scopes",
        status.json?.result?.isError !== true &&
          JSON.stringify(statusPayload).toLowerCase().includes("scope"),
        `keys=${Object.keys(statusPayload).join(",")}`,
      );

      const steps = await mcpCall(
        result.accessToken,
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "get_today_steps", arguments: {} },
        },
        mcpSession,
      );
      const stepsPayload = JSON.parse(steps.json?.result?.content?.[0]?.text ?? "{}");
      check(
        "confidential client: get_today_steps returns freshness metadata",
        steps.json?.result?.isError !== true && !!stepsPayload.freshness,
        `steps=${stepsPayload.steps ?? stepsPayload.totalSteps ?? "?"} retrievedAt=${stepsPayload.freshness?.retrievedAt ?? "?"}`,
      );
    };

    const scenarios: OAuthScenario[] = [
      {
        label: "confidential client",
        clientName: `e2e-confidential-${runId}`,
        authMethod: "client_secret_post",
      },
      {
        label: "public PKCE client",
        clientName: `e2e-public-${runId}`,
        authMethod: "none",
      },
    ];

    for (const scenario of scenarios) {
      try {
        const result = await runOAuthScenario(scenario);
        if (!result) continue;

        // This is deliberately the first request after token parsing: it
        // catches tokens that are issued successfully but rejected on use.
        const mcp = await exerciseMcp(result);
        await assertPersistedExpiry(result);
        await exerciseUserInfo(result);
        if (scenario.authMethod === "client_secret_post" && mcp.ready) {
          await exerciseConfidentialTools(result, mcp.mcpSession);
        }
      } catch (error) {
        const message = redactError(error).message;
        check(`${scenario.label}: scenario completed without crashing`, false, message.slice(0, 160));
      }
    }
  } finally {
    await cleanupArtifacts();
  }

  console.log(failures === 0 ? "ALL E2E CHECKS PASSED" : `${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  const safeError = redactError(err);
  console.error("live-verify-e2e crashed:", safeError.stack ?? safeError.message);
  process.exitCode = 1;
});
