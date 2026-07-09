import { describe, expect, it } from "vitest";
import { hashState } from "../../src/auth/state";

// The create/consume paths are single atomic SQL statements exercised against
// the live flow (Phase 3 prod consent + smoke script); here we pin the hash
// contract they both depend on.
describe("hashState", () => {
  it("is deterministic sha256 hex", () => {
    expect(hashState("abc")).toBe(hashState("abc"));
    expect(hashState("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different states", () => {
    expect(hashState("state-1")).not.toBe(hashState("state-2"));
  });
});
