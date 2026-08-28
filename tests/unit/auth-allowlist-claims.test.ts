import { beforeEach, describe, expect, it } from "vitest";
import { assertAllowedIdentityEmail } from "../../src/auth/auth";

describe("OAuth identity allowlist claims", () => {
  beforeEach(() => {
    process.env.ALLOWED_GOOGLE_EMAILS = "owner@example.test,owner+alias@example.test";
  });

  it("allows claims only for a currently approved identity", () => {
    expect(() => assertAllowedIdentityEmail("OWNER@EXAMPLE.TEST")).not.toThrow();
    expect(() => assertAllowedIdentityEmail("removed@example.test")).toThrow();
    expect(() => assertAllowedIdentityEmail(undefined)).toThrow();
  });
});
