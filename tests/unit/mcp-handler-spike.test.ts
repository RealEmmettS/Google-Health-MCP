import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
  type FetchLike,
} from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { mcpHttpHandler } from "../../src/mcp/server";

/**
 * SDK v2 conformance spike. Both protocol eras are driven through the official
 * v2 client and the exact production handler, with no session identifier.
 */

const authInfo: AuthInfo = {
  token: "test-token-not-logged",
  clientId: "sdk-v2-test",
  scopes: ["health:read", "health:write"],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  resource: new URL("http://localhost:3000/api/mcp"),
  extra: { userId: "test-user" },
};

const openClients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(openClients.splice(0).map((client) => client.close()));
});

const localFetch: FetchLike = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  return mcpHttpHandler.fetch(request, { authInfo });
};

async function connect(mode: "legacy" | "modern"): Promise<Client> {
  return connectWithFetch(mode, localFetch);
}

async function connectWithFetch(
  mode: "legacy" | "modern",
  fetch: FetchLike,
): Promise<Client> {
  const client = new Client(
    { name: `sdk-v2-${mode}-test`, version: "0.0.0" },
    {
      versionNegotiation:
        mode === "modern"
          ? { mode: { pin: "2026-07-28" } }
          : { mode: "legacy" },
    },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:3000/api/mcp"),
    { fetch },
  );
  await client.connect(transport);
  openClients.push(client);
  return client;
}

async function assertSurface(client: Client): Promise<void> {
  expect(client.getServerVersion()).toMatchObject({
    name: "shaughv-health-mcp",
    title: "SHAUGHV Health",
    description: expect.stringContaining("Private Google Health connector"),
    version: "1.0.1",
    websiteUrl: "https://health.emmetts.dev",
    icons: [
      {
        src: "https://health.emmetts.dev/shaughv-health-mcp-icon.png",
        mimeType: "image/png",
        sizes: ["1254x1254"],
      },
    ],
  });

  const list = await client.listTools();
  expect(list.tools).toHaveLength(18);
  const ping = list.tools.find((tool) => tool.name === "ping");
  expect(ping, "ping tool must be listed").toBeTruthy();
  expect(ping?.title).toBe("Ping");
  expect(ping?.inputSchema.type).toBe("object");
  expect(ping?.inputSchema.properties).toHaveProperty("echo");
  expect(ping?.outputSchema?.type).toBe("object");
  expect(ping?.annotations).toMatchObject({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });

  for (const tool of list.tools) {
    expect(tool.title, `${tool.name} title`).toBeTruthy();
    expect(tool.inputSchema.type, `${tool.name} input schema`).toBe("object");
    expect(tool.outputSchema?.type, `${tool.name} output schema`).toBe("object");
    expect(tool.annotations, `${tool.name} annotations`).toMatchObject({
      readOnlyHint: expect.any(Boolean),
      destructiveHint: expect.any(Boolean),
      idempotentHint: expect.any(Boolean),
      openWorldHint: expect.any(Boolean),
    });
    expect(tool._meta?.securitySchemes, `${tool.name} OAuth metadata`).toEqual([
      {
        type: "oauth2",
        scopes:
          tool.annotations?.readOnlyHint === true
            ? ["health:read"]
            : ["health:read", "health:write"],
      },
    ]);
  }

  const call = await client.callTool({
    name: "ping",
    arguments: { echo: "hello-sdk-v2" },
  });
  expect(call.structuredContent).toMatchObject({
    pong: true,
    echo: "hello-sdk-v2",
    authenticatedUserId: "test-user",
  });
  const payload = JSON.parse(
    (call.content[0] as { type: "text"; text: string }).text,
  ) as Record<string, unknown>;
  expect(payload).toMatchObject(call.structuredContent ?? {});

  const resources = await client.listResources();
  expect(resources.resources.map((resource) => resource.uri)).toContain(
    "health://data-types",
  );
  const dataTypes = await client.readResource({ uri: "health://data-types" });
  expect(dataTypes.contents[0]).toMatchObject({ mimeType: "application/json" });
}

describe("official MCP SDK v2 handler", () => {
  it("serves the modern 2026 request-scoped protocol", async () => {
    const client = await connect("modern");
    expect(client.getProtocolEra()).toBe("modern");
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    expect(client.getDiscoverResult()).toMatchObject({
      supportedVersions: expect.arrayContaining(["2026-07-28"]),
      ttlMs: 3_600_000,
      cacheScope: "private",
    });
    await assertSurface(client);
  });

  it("serves stateless legacy requests without Mcp-Session-Id", async () => {
    const client = await connect("legacy");
    expect(client.getProtocolEra()).toBe("legacy");
    await assertSurface(client);
  });

  it("rejects invalid tool arguments before invoking the handler", async () => {
    const client = await connect("modern");
    const result = await client.callTool({
      name: "ping",
      arguments: { echo: 42 },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text?: string }).text).toContain(
      "Input validation error",
    );
  });

  it("returns 405 for stateless legacy GET and DELETE", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await mcpHttpHandler.fetch(
        new Request("http://localhost:3000/api/mcp", { method }),
        { authInfo },
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("mcp-session-id")).toBeNull();
    }
  });

  it("rejects modern metadata header/body mismatches", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 91,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "metadata-mismatch-test",
            version: "0.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    };
    const response = await mcpHttpHandler.fetch(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "resources/list",
        },
        body: JSON.stringify(body),
      }),
      { authInfo, parsedBody: body },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("mismatch");
  });

  it("upgrades an individual modern response to SSE when a related event precedes the result", async () => {
    const streamingHandler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "stream-test", version: "0.0.0" });
        server.registerTool(
          "stream_once",
          {
            title: "Stream once",
            inputSchema: z.object({}),
            outputSchema: z.object({ complete: z.literal(true) }),
          },
          async (_args, ctx) => {
            await ctx.mcpReq.notify({
              method: "notifications/progress",
              params: { progressToken: "stream-test", progress: 1, total: 1 },
            });
            return {
              content: [{ type: "text", text: '{"complete":true}' }],
              structuredContent: { complete: true },
            };
          },
        );
        return server;
      },
      { legacy: "stateless", responseMode: "auto" },
    );
    let callContentType: string | null = null;
    const fetch: FetchLike = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const response = await streamingHandler.fetch(request, { authInfo });
      if (request.headers.get("mcp-method") === "tools/call") {
        callContentType = response.headers.get("content-type");
      }
      return response;
    };
    const client = await connectWithFetch("modern", fetch);
    const result = await client.callTool({ name: "stream_once", arguments: {} });
    expect(result.structuredContent).toEqual({ complete: true });
    expect(callContentType).toContain("text/event-stream");
    await streamingHandler.close();
  });

  it("propagates modern response-stream cancellation to the active tool", async () => {
    let markEntered!: () => void;
    let markAborted!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const cancellableHandler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "cancel-test", version: "0.0.0" });
        server.registerTool(
          "wait_for_cancel",
          {
            title: "Wait for cancellation",
            inputSchema: z.object({}),
            outputSchema: z.object({ cancelled: z.literal(true) }),
          },
          async (_args, ctx) => {
            markEntered();
            await new Promise<void>((resolve) => {
              if (ctx.mcpReq.signal.aborted) {
                markAborted();
                resolve();
                return;
              }
              ctx.mcpReq.signal.addEventListener(
                "abort",
                () => {
                  markAborted();
                  resolve();
                },
                { once: true },
              );
            });
            return {
              content: [{ type: "text", text: '{"cancelled":true}' }],
              structuredContent: { cancelled: true },
            };
          },
        );
        return server;
      },
      { legacy: "stateless", responseMode: "auto" },
    );
    const fetch: FetchLike = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return cancellableHandler.fetch(request, { authInfo });
    };
    const client = await connectWithFetch("modern", fetch);
    const controller = new AbortController();
    const call = client.callTool(
      { name: "wait_for_cancel", arguments: {} },
      { signal: controller.signal },
    );
    await entered;
    controller.abort();
    await expect(call).rejects.toThrow();
    await aborted;
    await cancellableHandler.close();
  });
});
