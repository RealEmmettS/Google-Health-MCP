import { describe, expect, it } from "vitest";
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPES } from "../../src/auth/auth";
import { protectedResourceMetadataResponse } from "../../src/auth/protected-resource-metadata";

describe("MCP protected-resource metadata", () => {
  it("points at the authorization server without narrowing connector scopes", async () => {
    const response = protectedResourceMetadataResponse();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: MCP_RESOURCE,
      resource_name: "SHAUGHV Health MCP",
      authorization_servers: [MCP_ISSUER],
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
