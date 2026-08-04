import { describe, expect, it } from "vitest";
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPES } from "../../src/auth/auth";
import { protectedResourceMetadataResponse } from "../../src/auth/protected-resource-metadata";

describe("MCP protected-resource metadata", () => {
  it("advertises the complete approved initial grant", async () => {
    const response = protectedResourceMetadataResponse();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: MCP_RESOURCE,
      resource_name: "SHAUGHV Health MCP",
      resource_documentation: MCP_ISSUER,
      authorization_servers: [MCP_ISSUER],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ["header"],
    });
  });

  it("keeps offline continuity in the authorization-server scope contract", () => {
    expect(MCP_SCOPES).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
      "health:read",
      "health:write",
    ]);
  });
});
