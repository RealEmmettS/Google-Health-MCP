import { isJsonContentType, isLegacyRequest } from "@modelcontextprotocol/server";

export const MAX_MCP_BODY_BYTES = 256 * 1024;

type PreparedMcpRequest =
  | { parsedBody?: unknown; era: "legacy" | "modern" }
  | { response: Response; era: "unknown" };

export interface McpTelemetry {
  era: "legacy" | "modern" | "unknown";
  method?: string;
  name?: string;
  durationMs: number;
  status: number;
  instance: "cold" | "warm";
}

let hasHandledRequest = false;

function configuredOrigins(): Set<string> {
  const candidates = [
    "https://health.emmetts.dev",
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    process.env.VERCEL_BRANCH_URL
      ? `https://${process.env.VERCEL_BRANCH_URL}`
      : undefined,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    ...(process.env.MCP_ALLOWED_ORIGINS ?? "").split(","),
  ];

  const origins = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.pathname !== "/" || url.search || url.hash) continue;
      origins.add(url.origin);
    } catch {
      // Ignore malformed configuration instead of weakening the boundary.
    }
  }
  return origins;
}

function jsonError(status: number, message: string): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    },
    { status },
  );
}

function validateHostAndOrigin(request: Request): Response | undefined {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== "/api/mcp" || requestUrl.search || requestUrl.hash) {
    return jsonError(404, "MCP endpoint not found");
  }

  const allowedOrigins = configuredOrigins();
  const allowedHosts = new Set(
    [...allowedOrigins].map((origin) => new URL(origin).host.toLowerCase()),
  );

  const host = request.headers.get("host")?.trim().toLowerCase();
  if (!host || host.includes(",") || !allowedHosts.has(host)) {
    return jsonError(403, "Invalid Host header");
  }

  const originHeader = request.headers.get("origin");
  if (originHeader === null || originHeader === "") return undefined;
  if (originHeader.includes(",") || originHeader === "null") {
    return jsonError(403, "Invalid Origin header");
  }

  try {
    const parsed = new URL(originHeader);
    if (
      parsed.origin !== originHeader ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !allowedOrigins.has(parsed.origin)
    ) {
      return jsonError(403, "Invalid Origin header");
    }
  } catch {
    return jsonError(403, "Invalid Origin header");
  }
  return undefined;
}

async function readJsonBody(request: Request): Promise<unknown | Response> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return jsonError(415, "Content-Type must be application/json");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_MCP_BODY_BYTES
    ) {
      return jsonError(413, "MCP request body exceeds 256 KiB");
    }
  }

  if (!request.body) return jsonError(400, "MCP request body is required");
  // Consume the original stream exactly once. The parsed value is passed to
  // the SDK, so neither authentication nor transport dispatch needs to read
  // the body again. Avoiding Request.clone() also prevents undici's tee branch
  // from buffering an attacker-controlled body while the other branch idles.
  const reader = request.body.getReader();
  if (!reader) return jsonError(400, "MCP request body is required");

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_MCP_BODY_BYTES) {
      await reader.cancel();
      return jsonError(413, "MCP request body exceeds 256 KiB");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return jsonError(400, "Malformed JSON request body");
  }
}

export async function prepareMcpRequest(
  request: Request,
): Promise<PreparedMcpRequest> {
  const rejected = validateHostAndOrigin(request);
  if (rejected) return { response: rejected, era: "unknown" };

  if (request.method !== "POST") {
    const legacy = await isLegacyRequest(request);
    return {
      era: legacy ? "legacy" : "modern",
    };
  }

  const parsedBody = await readJsonBody(request);
  if (parsedBody instanceof Response) {
    return { response: parsedBody, era: "unknown" };
  }

  return {
    parsedBody,
    era: (await isLegacyRequest(request, parsedBody)) ? "legacy" : "modern",
  };
}

function safeTelemetryValue(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[a-z0-9_./:-]{1,80}$/i.test(value)) {
    return undefined;
  }
  return value;
}

export function requestTelemetryFields(parsedBody: unknown): {
  method?: string;
  name?: string;
} {
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return {};
  }
  const body = parsedBody as Record<string, unknown>;
  const method = safeTelemetryValue(body.method);
  const params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : undefined;
  return {
    method,
    name:
      method === "tools/call" || method === "resources/read"
        ? safeTelemetryValue(params?.name ?? params?.uri)
        : undefined,
  };
}

export function requestInstanceMarker(): "cold" | "warm" {
  const marker = hasHandledRequest ? "warm" : "cold";
  hasHandledRequest = true;
  return marker;
}

export function withPrivateNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function recordMcpTelemetry(event: McpTelemetry): void {
  // Deliberately allowlisted fields only. Never include request params, result
  // bodies, health values, bearer headers, OAuth codes, or errors.
  console.info("mcp_transport", JSON.stringify(event));
}
