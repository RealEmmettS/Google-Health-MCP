/**
 * Phase 7 live E2E: prove the full OAuth 2.1 + MCP path against PRODUCTION
 * (https://health.emmetts.dev) end-to-end, headlessly.
 *
 * Real client path (what claude.ai / ChatGPT / Claude Code actually do):
 *   1. read /.well-known/oauth-authorization-server
 *   2. DCR register a client
 *   3. PKCE /authorize  (Google login is the only un-automatable step; we
 *      satisfy it by minting a better-auth session row + signing its cookie
 *      exactly as the server would — same HMAC scheme, same prod cookie name)
 *   4. form-encoded /token exchange  → access_token
 *   5. POST /api/mcp with Bearer  → initialize, tools/list, tools/call
 *
 * Fallback: if the forged-session authorize/token dance fails (e.g. the local
 * BETTER_AUTH_SECRET does not match prod), we insert an oauth_access_token row
 * directly and still exercise step 5 — the one seam (withMcpAuth → token verify
 * → app-user resolution → tool execution over deployed HTTP) that nothing else
 * covers. Everything created here is deleted before exit.
 *
 * Usage: npx tsx scripts/live-verify-e2e.ts [baseUrl] [email]
 */
import { createHmac, randomBytes, createHash, randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });

const BASE = (process.argv[2] ?? "https://health.emmetts.dev").replace(/\/$/, "");
const EMAIL = process.argv[3] ?? "eshaughv@gmail.com";
const REDIRECT_URI = "http://localhost:9876/callback";
const SECRET = process.env.BETTER_AUTH_SECRET ?? "";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures += 1;
};

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
): Promise<{ json: any; sessionId: string | null }> {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  return { json: await parseRpc(res), sessionId: res.headers.get("mcp-session-id") };
}

async function main() {
  const { db } = await import("../src/db/client");
  const { sql } = await import("drizzle-orm");

  console.log(`\n=== Phase 7 E2E against ${BASE} (user ${EMAIL}) ===\n`);

  // 0) Negative check: unauthenticated /api/mcp must 401 with WWW-Authenticate.
  {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }),
    });
    check(
      "unauthenticated /api/mcp → 401 + WWW-Authenticate",
      res.status === 401 && !!res.headers.get("www-authenticate"),
      `status=${res.status} wwwauth=${res.headers.get("www-authenticate") ?? "none"}`,
    );
  }

  // 1) Discovery metadata (the client's entrypoint).
  const meta = await fetch(`${BASE}/.well-known/oauth-authorization-server`).then((r) => r.json());
  check(
    "AS metadata: issuer + endpoints present",
    meta.issuer === BASE && !!meta.authorization_endpoint && !!meta.token_endpoint && !!meta.registration_endpoint,
    `issuer=${meta.issuer}`,
  );

  // Resolve the better-auth user id (what the access token is keyed to).
  const userRow = (
    await db.execute(sql`select id, email, name from "user" where lower(email) = lower(${EMAIL}) limit 1`)
  ).rows?.[0] as { id?: string } | undefined;
  if (!userRow?.id) throw new Error(`no better-auth user row for ${EMAIL} — has Emmett signed in on prod?`);
  const betterAuthUserId = userRow.id;

  // 2) DCR register.
  let clientId = "";
  let clientSecret = "";
  {
    const res = await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "e2e-verify",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    const reg = await res.json();
    clientId = reg.client_id;
    clientSecret = reg.client_secret ?? "";
    check("DCR register → client_id", !!clientId && res.status < 300, `status=${res.status} client_id=${clientId ? "yes" : "no"}`);
  }

  // 3) Establish a logged-in session (forge the cookie the way the server signs it).
  const sessionToken = randomUUID().replace(/-/g, "") + randomBytes(8).toString("hex");
  const sessionRowId = randomUUID();
  const sessionExpiry = new Date(Date.now() + 60 * 60 * 1000);
  await db.execute(sql`
    insert into "session" ("id","expires_at","token","created_at","updated_at","user_id")
    values (${sessionRowId}, ${sessionExpiry.toISOString()}, ${sessionToken}, now(), now(), ${betterAuthUserId})
  `);
  // Secure prefix only when the target speaks https (prod); http (localhost) omits it.
  const cookieName = `${BASE.startsWith("https://") ? "__Secure-" : ""}better-auth.session_token`;
  const cookieHeader = `${cookieName}=${signCookie(sessionToken, SECRET)}`;

  // 4) PKCE authorize.
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());
  const state = randomUUID();
  const authorizeUrl =
    `${meta.authorization_endpoint}?response_type=code&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent("openid profile email offline_access")}` +
    `&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  let realTokenPath = false;
  let accessToken = "";
  let insertedTokenId = "";

  const authRes = await fetch(authorizeUrl, {
    method: "GET",
    headers: { cookie: cookieHeader },
    redirect: "manual",
  });
  const location = authRes.headers.get("location") ?? "";
  const gotCode = location.startsWith(REDIRECT_URI) && /[?&]code=/.test(location);
  const code = gotCode ? new URL(location).searchParams.get("code")! : "";
  check(
    "authorize with forged session → redirect to redirect_uri with ?code",
    gotCode,
    gotCode ? "code issued" : `Location=${location.slice(0, 90) || "(none)"} status=${authRes.status}`,
  );

  // 5) Token exchange (FORM-ENCODED — the claude.ai #313 watchout).
  if (gotCode) {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: codeVerifier,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });
    const tokRes = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
    });
    const tok = await tokRes.json().catch(() => ({}));
    check(
      "token endpoint accepts form-encoded POST → access_token",
      tokRes.status < 300 && !!tok.access_token,
      `status=${tokRes.status} keys=${Object.keys(tok).join(",")}`,
    );
    if (tok.access_token) {
      accessToken = tok.access_token;
      realTokenPath = true;
    }
  }

  // Fallback: mint the access token directly so step 6 always runs.
  if (!accessToken) {
    console.log("  (falling back to direct token insert — the forged-session path did not yield a token)");
    accessToken = randomBytes(24).toString("base64url");
    insertedTokenId = randomUUID();
    await db.execute(sql`
      insert into "oauth_access_token"
        ("id","access_token","access_token_expires_at","client_id","user_id","scopes","created_at","updated_at")
      values (${insertedTokenId}, ${accessToken}, ${new Date(Date.now() + 60 * 60 * 1000).toISOString()},
        ${clientId || null}, ${betterAuthUserId}, ${"openid profile email"}, now(), now())
    `);
  }
  console.log(`  token path: ${realTokenPath ? "FULL OAuth chain (register→authorize→token)" : "direct-insert fallback"}\n`);

  // 6) Authenticated MCP calls over deployed prod HTTP.
  const init = await mcpCall(accessToken, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } },
  });
  check(
    "initialize → serverInfo shaughv-health-mcp",
    init.json?.result?.serverInfo?.name === "shaughv-health-mcp",
    `name=${init.json?.result?.serverInfo?.name}`,
  );
  const mcpSession = init.sessionId ?? undefined;
  if (mcpSession) {
    await mcpCall(accessToken, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, mcpSession);
  }

  const list = await mcpCall(accessToken, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, mcpSession);
  const tools: Array<{ name: string }> = list.json?.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  check("tools/list returns the full surface", names.length >= 15, `${names.length} tools: ${names.join(", ")}`);
  check(
    "read + write tools both present; NO sleep/exercise/settings write",
    names.includes("get_today_steps") &&
      names.includes("create_nutrition_log") &&
      !names.some((n) => /write.*(sleep|exercise|setting)|update_(sleep|exercise|setting)/.test(n)),
  );

  // ping — proves the authenticated user id flows through withMcpAuth.
  const ping = await mcpCall(
    accessToken,
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ping", arguments: { echo: "e2e" } } },
    mcpSession,
  );
  const pingPayload = JSON.parse(ping.json?.result?.content?.[0]?.text ?? "{}");
  check(
    "ping authenticated as the token's user",
    pingPayload.pong === true && pingPayload.authenticatedUserId === betterAuthUserId,
    `authedUserId=${pingPayload.authenticatedUserId}`,
  );

  // get_sync_status — real connection + granted scopes over the wire.
  const status = await mcpCall(
    accessToken,
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_sync_status", arguments: {} } },
    mcpSession,
  );
  const statusPayload = JSON.parse(status.json?.result?.content?.[0]?.text ?? "{}");
  check(
    "get_sync_status → connected with granted scopes",
    status.json?.result?.isError !== true && JSON.stringify(statusPayload).toLowerCase().includes("scope"),
    `keys=${Object.keys(statusPayload).join(",")}`,
  );

  // get_today_steps — real Google Health data through the whole stack on prod.
  const steps = await mcpCall(
    accessToken,
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_today_steps", arguments: {} } },
    mcpSession,
  );
  const stepsText = steps.json?.result?.content?.[0]?.text ?? "";
  const stepsPayload = JSON.parse(stepsText || "{}");
  check(
    "get_today_steps → real data with freshness metadata",
    steps.json?.result?.isError !== true && !!stepsPayload.freshness,
    `steps=${stepsPayload.steps ?? stepsPayload.totalSteps ?? "?"} retrievedAt=${stepsPayload.freshness?.retrievedAt ?? "?"}`,
  );

  // Cleanup: remove everything this run created.
  await db.execute(sql`delete from "session" where "id" = ${sessionRowId}`);
  if (insertedTokenId) await db.execute(sql`delete from "oauth_access_token" where "id" = ${insertedTokenId}`);
  if (clientId) await db.execute(sql`delete from "oauth_application" where "client_id" = ${clientId}`); // cascades tokens/consents
  console.log("\n  cleaned up: session row, access token(s), DCR client\n");

  console.log(failures === 0 ? "ALL E2E CHECKS PASSED" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("live-verify-e2e crashed:", err?.stack ?? err?.message ?? err);
  process.exit(1);
});
