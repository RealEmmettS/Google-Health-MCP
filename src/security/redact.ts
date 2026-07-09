/**
 * Redaction helpers — every error path and log line that could touch OAuth
 * material must pass through these (docs/PLAN.md: "No plaintext tokens
 * anywhere, ever"). Redacts by sensitive KEY name in objects and by token
 * PATTERN in strings.
 */

const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set(
  [
    "access_token",
    "accesstoken",
    "refresh_token",
    "refreshtoken",
    "id_token",
    "idtoken",
    "client_secret",
    "clientsecret",
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "token",
    "secret",
    "password",
    "apikey",
    "api_key",
  ].map((k) => k.toLowerCase()),
);

const TOKEN_PATTERNS: RegExp[] = [
  /ya29\.[\w.\-]+/g, // Google access tokens
  /1\/\/[\w.\-]+/g, // Google refresh tokens
  /GOCSPX-[\w\-]+/g, // Google client secrets
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, // JWTs
  /\b(Bearer|Basic)\s+[\w.\-~+/]+=*/gi, // Authorization header values
  /\bnpg_[\w]+/g, // Neon passwords
];

export function redactString(input: string): string {
  let out = input;
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function redactValue<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (depth > 8) return REDACTED as unknown as T;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[CIRCULAR]" as unknown as T;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1, seen)) as unknown as T;
  }
  if (value instanceof Error) {
    return redactError(value) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? REDACTED
      : redactValue(v, depth + 1, seen);
  }
  return out as T;
}

export function redactError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactString(error.message),
      stack: error.stack ? redactString(error.stack) : undefined,
    };
  }
  return { name: "UnknownError", message: redactString(String(error)) };
}
