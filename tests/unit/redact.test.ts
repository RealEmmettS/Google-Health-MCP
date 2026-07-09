import { describe, expect, it } from "vitest";
import { redactError, redactString, redactValue } from "../../src/security/redact";

describe("redactString", () => {
  it.each([
    ["Google access token", "got ya29.a0AbCdEf-123_xyz from google"],
    ["Google refresh token", "refresh with 1//05EuqYpEXjJCHCgYIA"],
    ["Google client secret", "secret is GOCSPX-yXoIIabc-def123"],
    ["Bearer header", "Authorization: Bearer abc.def-ghi_jkl"],
    ["JWT", "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sflKxwRJSMeKKF2QT4"],
    ["Neon password", "postgresql://user:npg_aEF98dBSwKCP@host/db"],
  ])("redacts %s", (_label, input) => {
    const out = redactString(input);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toMatch(/ya29\.|1\/\/|GOCSPX-|eyJ|npg_|Bearer\s+\w/);
  });

  it("leaves ordinary text alone", () => {
    expect(redactString("steps today: 8000")).toBe("steps today: 8000");
  });
});

describe("redactValue", () => {
  it("redacts sensitive keys at any depth, case-insensitively", () => {
    const input = {
      ok: "visible",
      access_token: "ya29.x",
      nested: {
        refreshToken: "1//abc",
        Authorization: "Bearer x",
        list: [{ client_secret: "GOCSPX-x" }, "plain"],
      },
    };
    const out = redactValue(input) as typeof input;
    expect(out.ok).toBe("visible");
    expect(out.access_token).toBe("[REDACTED]");
    expect(out.nested.refreshToken).toBe("[REDACTED]");
    expect(out.nested.Authorization).toBe("[REDACTED]");
    expect((out.nested.list[0] as { client_secret: string }).client_secret).toBe(
      "[REDACTED]",
    );
    expect(out.nested.list[1]).toBe("plain");
  });

  it("redacts token patterns inside non-sensitive string fields", () => {
    const out = redactValue({ note: "token was ya29.abc123" }) as { note: string };
    expect(out.note).toContain("[REDACTED]");
  });

  it("survives circular references", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const out = redactValue(obj) as Record<string, unknown>;
    expect(out.a).toBe(1);
    expect(out.self).toBe("[CIRCULAR]");
  });

  it("preserves non-object primitives", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBe(null);
    expect(redactValue(true)).toBe(true);
  });
});

describe("redactError", () => {
  it("redacts message and stack", () => {
    const error = new Error("exchange failed for ya29.secret-token");
    const out = redactError(error);
    expect(out.message).not.toContain("ya29.");
    expect(out.message).toContain("[REDACTED]");
    expect(out.stack ?? "").not.toContain("ya29.");
  });

  it("handles non-Error values", () => {
    const out = redactError("raw 1//refresh-token string");
    expect(out.name).toBe("UnknownError");
    expect(out.message).toContain("[REDACTED]");
  });
});
