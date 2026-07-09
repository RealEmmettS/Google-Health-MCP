import { createMcpHandler } from "mcp-handler";
import { describe, expect, it } from "vitest";
import { registerTools } from "../../src/mcp/register-tools";

/**
 * Phase 5 risk spike: proves mcp-handler works with zod 4 schemas —
 * registration, JSON-Schema conversion for tools/list, and invocation —
 * by driving the real handler with raw JSON-RPC over streamable HTTP.
 */

const handler = createMcpHandler(
  (server) => registerTools(server, { userId: "test-user" }),
  { serverInfo: { name: "shaughv-health-mcp", version: "0.1.0" } },
  { basePath: "/api" },
);

function rpcRequest(body: unknown, sessionId?: string): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function parseRpcResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trimStart().startsWith("{")) return JSON.parse(text);
  // Streamable HTTP may answer as SSE frames: "event: message\ndata: {...}"
  const dataLines = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  expect(dataLines.length).toBeGreaterThan(0);
  return JSON.parse(dataLines[dataLines.length - 1]);
}

async function initialize(): Promise<string | null> {
  const response = await handler(
    rpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "spike-test", version: "0.0.0" },
      },
    }),
  );
  expect(response.status).toBeLessThan(300);
  const body = (await parseRpcResponse(response)) as {
    result?: { serverInfo?: { name?: string } };
  };
  expect(body.result?.serverInfo?.name).toBe("shaughv-health-mcp");
  return response.headers.get("mcp-session-id");
}

describe("mcp-handler + zod 4 spike", () => {
  it("initializes, lists the ping tool with a converted schema, and calls it", async () => {
    const sessionId = await initialize();

    const listResponse = await handler(
      rpcRequest(
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        sessionId ?? undefined,
      ),
    );
    const list = (await parseRpcResponse(listResponse)) as {
      result?: {
        tools?: Array<{
          name: string;
          inputSchema?: { type?: string; properties?: Record<string, unknown> };
        }>;
      };
    };
    const ping = list.result?.tools?.find((t) => t.name === "ping");
    expect(ping, "ping tool must be listed").toBeTruthy();
    // The load-bearing assertion: zod 4 shape became real JSON Schema.
    expect(ping?.inputSchema?.type).toBe("object");
    expect(ping?.inputSchema?.properties).toHaveProperty("echo");

    const callResponse = await handler(
      rpcRequest(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "ping", arguments: { echo: "hello-zod4" } },
        },
        sessionId ?? undefined,
      ),
    );
    const call = (await parseRpcResponse(callResponse)) as {
      result?: { content?: Array<{ type: string; text: string }> };
    };
    const text = call.result?.content?.[0]?.text ?? "";
    const payload = JSON.parse(text) as {
      pong: boolean;
      echo: string;
      authenticatedUserId: string;
    };
    expect(payload.pong).toBe(true);
    expect(payload.echo).toBe("hello-zod4");
    expect(payload.authenticatedUserId).toBe("test-user");
  });

  it("rejects invalid tool arguments via the zod schema", async () => {
    const sessionId = await initialize();
    const response = await handler(
      rpcRequest(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "ping", arguments: { echo: 42 } },
        },
        sessionId ?? undefined,
      ),
    );
    const body = (await parseRpcResponse(response)) as {
      error?: { message?: string };
      result?: { isError?: boolean };
    };
    // Either a JSON-RPC error or a tool-level isError is acceptable — the
    // point is that a non-string echo does not reach the handler as-is.
    expect(Boolean(body.error) || body.result?.isError === true).toBe(true);
  });
});
