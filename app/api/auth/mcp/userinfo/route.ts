import { sql } from "drizzle-orm";
import { auth } from "@/src/auth/auth";
import { db } from "@/src/db/client";
import { redactError } from "@/src/security/redact";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

async function userInfo(request: Request): Promise<Response> {
  try {
    const token = await auth.api.getMcpSession({
      request,
      headers: request.headers,
      asResponse: false,
    });
    const userId = token?.userId;
    if (!userId) {
      return Response.json(
        { error: "invalid_token" },
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "WWW-Authenticate": 'Bearer error="invalid_token"',
          },
        },
      );
    }

    const scopes = new Set((token.scopes ?? "").split(" ").filter(Boolean));
    if (!scopes.has("openid")) {
      return Response.json(
        { error: "insufficient_scope" },
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="openid"',
          },
        },
      );
    }

    const row = (
      await db.execute(sql`
        select "name", "email", "email_verified", "image", "updated_at"
        from "user"
        where "id" = ${userId}
        limit 1
      `)
    ).rows?.[0] as
      | {
          name?: string;
          email?: string;
          email_verified?: boolean;
          image?: string | null;
          updated_at?: Date | string;
        }
      | undefined;
    if (!row) {
      return Response.json(
        { error: "invalid_token" },
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "WWW-Authenticate": 'Bearer error="invalid_token"',
          },
        },
      );
    }

    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : Number.NaN;
    return Response.json(
      {
        sub: userId,
        ...(scopes.has("profile")
          ? {
              name: row.name,
              given_name: row.name?.split(" ")[0],
              family_name: row.name?.split(" ").slice(1).join(" ") || undefined,
              picture: row.image ?? undefined,
              updated_at: Number.isFinite(updatedAt)
                ? Math.floor(updatedAt / 1000)
                : undefined,
            }
          : {}),
        ...(scopes.has("email")
          ? {
              email: row.email,
              email_verified: row.email_verified,
            }
          : {}),
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error("MCP userinfo failed", redactError(error));
    return Response.json(
      { error: "server_error" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export const GET = userInfo;
export const POST = userInfo;

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}
