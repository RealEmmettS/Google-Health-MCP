import { MCP_ISSUER, MCP_RESOURCE } from "./auth";

export function protectedResourceMetadataResponse(): Response {
  return Response.json(
    {
      resource: MCP_RESOURCE,
      resource_name: "SHAUGHV Health MCP",
      authorization_servers: [MCP_ISSUER],
      scopes_supported: ["health:read", "health:write"],
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
