import { MCP_ISSUER, MCP_RESOURCE } from "./auth";

export function protectedResourceMetadataResponse(): Response {
  return Response.json(
    {
      resource: MCP_RESOURCE,
      resource_name: "SHAUGHV Health MCP",
      authorization_servers: [MCP_ISSUER],
      // Deliberately omit optional resource scope metadata. Several current
      // desktop clients treat it as the complete authorization request and
      // consequently omit `offline_access`, leaving an otherwise successful
      // loopback callback with only a one-hour access token. Those clients
      // instead fall back to the authorization server's complete scope list.
      // Resource-specific step-up remains explicit in 403 challenges.
      bearer_methods_supported: ["header"],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}
