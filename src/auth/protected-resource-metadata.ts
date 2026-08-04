import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPES } from "./auth";

export function protectedResourceMetadataResponse(): Response {
  return Response.json(
    {
      resource: MCP_RESOURCE,
      resource_name: "SHAUGHV Health MCP",
      resource_documentation: MCP_ISSUER,
      authorization_servers: [MCP_ISSUER],
      // Interoperability exception: current clients differ in which discovery
      // surface they treat as authoritative. Advertise the complete approved
      // initial grant here, including offline continuity. Operation-specific
      // 403 challenges remain narrow.
      scopes_supported: MCP_SCOPES,
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
