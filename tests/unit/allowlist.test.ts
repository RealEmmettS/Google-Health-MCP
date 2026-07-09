import { describe, expect, it } from "vitest";
import { getAllowedEmails, isAllowedEmail } from "../../src/auth/allowlist";

const env = (value?: string) => ({ ALLOWED_GOOGLE_EMAILS: value });

describe("allowlist", () => {
  it("parses a comma-separated list with whitespace", () => {
    expect(getAllowedEmails(env(" a@x.com , B@Y.com ,,"))).toEqual([
      "a@x.com",
      "b@y.com",
    ]);
  });

  it("is empty when unset", () => {
    expect(getAllowedEmails(env(undefined))).toEqual([]);
    expect(getAllowedEmails(env(""))).toEqual([]);
  });

  it("matches case-insensitively and trims", () => {
    const e = env("eshaughv@gmail.com,google@emmetts.dev");
    expect(isAllowedEmail("EShaughV@Gmail.com", e)).toBe(true);
    expect(isAllowedEmail("  google@emmetts.dev  ", e)).toBe(true);
  });

  it("rejects non-listed, null, and empty emails", () => {
    const e = env("eshaughv@gmail.com");
    expect(isAllowedEmail("stranger@gmail.com", e)).toBe(false);
    expect(isAllowedEmail(null, e)).toBe(false);
    expect(isAllowedEmail(undefined, e)).toBe(false);
    expect(isAllowedEmail("", e)).toBe(false);
  });

  it("fails closed when the allowlist is empty", () => {
    expect(isAllowedEmail("anyone@gmail.com", env(undefined))).toBe(false);
  });
});
