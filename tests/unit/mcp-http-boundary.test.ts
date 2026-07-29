import { describe, expect, it, vi } from "vitest";
import {
  MAX_MCP_BODY_BYTES,
  prepareMcpRequest,
  requestTelemetryFields,
  withPrivateNoStore,
} from "../../src/mcp/http-boundary";

function request(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

describe("MCP HTTP boundary", () => {
  it("allows absent Origin for server clients and exact configured browser origins", async () => {
    const noOrigin = await prepareMcpRequest(
      request('{"jsonrpc":"2.0","id":1,"method":"tools/list"}'),
    );
    expect("response" in noOrigin).toBe(false);

    const browser = await prepareMcpRequest(
      request('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', {
        origin: "http://localhost:3000",
      }),
    );
    expect("response" in browser).toBe(false);
  });

  it.each([
    [{ host: "attacker.example" }, "host"],
    [{ origin: "https://attacker.example" }, "origin"],
    [{ origin: "null" }, "opaque origin"],
    [{ origin: "http://localhost:3001" }, "wrong local port"],
  ])("rejects an invalid %s boundary", async (headers, _label) => {
    const prepared = await prepareMcpRequest(
      request('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', headers),
    );
    expect("response" in prepared && prepared.response.status).toBe(403);
  });

  it("derives the active Vercel preview origin exactly", async () => {
    vi.stubEnv("VERCEL_URL", "google-health-preview.vercel.app");
    try {
      const prepared = await prepareMcpRequest(
        new Request("https://google-health-preview.vercel.app/api/mcp", {
          method: "POST",
          headers: {
            host: "google-health-preview.vercel.app",
            origin: "https://google-health-preview.vercel.app",
            "content-type": "application/json",
          },
          body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
        }),
      );
      expect("response" in prepared).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("serves only the canonical MCP route", async () => {
    for (const url of [
      "http://localhost:3000/api/not-mcp",
      "http://localhost:3000/api/mcp?redirect=1",
    ]) {
      const prepared = await prepareMcpRequest(
        new Request(url, {
          method: "POST",
          headers: {
            host: "localhost:3000",
            "content-type": "application/json",
          },
          body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
        }),
      );
      expect("response" in prepared && prepared.response.status).toBe(404);
    }
  });

  it("rejects unsupported media, malformed JSON, and declared or streamed oversize bodies", async () => {
    const media = await prepareMcpRequest(
      request("{}", { "content-type": "text/plain" }),
    );
    expect("response" in media && media.response.status).toBe(415);

    const malformed = await prepareMcpRequest(request("{"));
    expect("response" in malformed && malformed.response.status).toBe(400);

    const declared = await prepareMcpRequest(
      request("{}", { "content-length": String(MAX_MCP_BODY_BYTES + 1) }),
    );
    expect("response" in declared && declared.response.status).toBe(413);

    const streamed = await prepareMcpRequest(
      request(JSON.stringify({ value: "x".repeat(MAX_MCP_BODY_BYTES) })),
    );
    expect("response" in streamed && streamed.response.status).toBe(413);
  });

  it("extracts only allowlisted telemetry fields and never arguments", () => {
    const fields = requestTelemetryFields({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "ping",
        arguments: {
          authorization: "Bearer secret",
          food: "private meal",
        },
      },
    });
    expect(fields).toEqual({ method: "tools/call", name: "ping" });
    expect(JSON.stringify(fields)).not.toMatch(/secret|private meal/i);
  });

  it("forces private no-store without dropping an auth challenge", () => {
    const response = withPrivateNoStore(
      new Response("unauthorized", {
        status: 401,
        headers: { "www-authenticate": 'Bearer realm="mcp"' },
      }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="mcp"');
  });
});
