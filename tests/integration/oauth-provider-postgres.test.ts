import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/db/client";
import {
  mcpOauthAccessTokenV2,
  mcpOauthClientV2,
} from "../../src/db/auth-schema";

const enabled =
  process.env.RUN_DB_INTEGRATION === "rehearsal-only" &&
  !!process.env.DATABASE_URL;

const baseUrl = "http://localhost:3010";
const resource = `${baseUrl}/api/mcp`;
const clientName = `mcp-030-db-rehearsal-${Date.now()}`;
let registeredClientId: string | undefined;
let post: (request: Request) => Promise<Response>;
let get: (request: Request) => Promise<Response>;

describe.skipIf(!enabled)("stable OAuth Provider on PostgreSQL", () => {
  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = baseUrl;
    process.env.NEXT_PUBLIC_APP_URL = baseUrl;
    process.env.BETTER_AUTH_SECRET = "rehearsal-only-better-auth-secret-32-bytes";
    process.env.ALLOWED_GOOGLE_EMAILS = "owner@example.test";
    process.env.GOOGLE_CLIENT_ID = "rehearsal-google-client";
    process.env.GOOGLE_CLIENT_SECRET = "rehearsal-google-secret";
    ({ GET: get, POST: post } = await import("../../app/api/auth/[...all]/route"));
  });

  afterAll(async () => {
    if (registeredClientId) {
      await db
        .delete(mcpOauthClientV2)
        .where(eq(mcpOauthClientV2.clientId, registeredClientId));
    }
  });

  it("persists a public S256 connector only in the isolated v2 tables", async () => {
    const response = await post(
      new Request(`${baseUrl}/api/auth/oauth2/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.30",
        },
        body: JSON.stringify({
          application_type: "native",
          client_name: clientName,
          redirect_uris: ["http://127.0.0.1:43123/callback"],
          resources: [resource],
          token_endpoint_auth_method: "client_secret_post",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = (await response.json()) as {
      application_type?: string;
      client_id?: string;
      client_secret?: string;
      token_endpoint_auth_method?: string;
    };
    expect(body).toMatchObject({
      application_type: "native",
      token_endpoint_auth_method: "none",
    });
    expect(body.client_secret).toBeUndefined();
    registeredClientId = body.client_id;
    expect(registeredClientId).toBeTruthy();

    const rows = await db
      .select()
      .from(mcpOauthClientV2)
      .where(
        and(
          eq(mcpOauthClientV2.clientId, registeredClientId!),
          eq(mcpOauthClientV2.name, clientName),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      public: true,
      tokenEndpointAuthMethod: "none",
      type: "native",
      scopes: [
        "openid",
        "profile",
        "email",
        "offline_access",
        "health:read",
        "health:write",
      ],
    });

    const authorizeWithoutPkce = await get(
      new Request(
        `${baseUrl}/api/auth/oauth2/authorize?` +
          new URLSearchParams({
            client_id: registeredClientId!,
            // RFC 8252 allows native loopback clients to choose their actual
            // listening port at authorization time.
            redirect_uri: "http://127.0.0.1:43876/callback",
            response_type: "code",
            scope: "health:read",
            resource,
          }),
      ),
    );
    expect(authorizeWithoutPkce.status).toBe(302);
    const rejection = new URL(authorizeWithoutPkce.headers.get("location")!);
    expect(rejection.origin + rejection.pathname).toBe(
      "http://127.0.0.1:43876/callback",
    );
    expect(rejection.searchParams.get("error")).toBe("invalid_request");
    expect(rejection.searchParams.get("iss")).toBe(baseUrl);

    const accessRows = await db.select().from(mcpOauthAccessTokenV2);
    expect(accessRows).toHaveLength(0);
  });

  it("rejects a noncanonical registration resource without persisting it", async () => {
    const response = await post(
      new Request(`${baseUrl}/api/auth/oauth2/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: `${clientName}-wrong-resource`,
          redirect_uris: ["https://client.example.test/callback"],
          resource: "https://other.example.test/api/mcp",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_target" });

    const rows = await db
      .select({ id: mcpOauthClientV2.id })
      .from(mcpOauthClientV2)
      .where(eq(mcpOauthClientV2.name, `${clientName}-wrong-resource`));
    expect(rows).toHaveLength(0);
  });
});
