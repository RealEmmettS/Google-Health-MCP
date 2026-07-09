import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CURRENT_KEY_VERSION,
  decryptSecret,
  EncryptionError,
  encryptSecret,
} from "../../src/security/encryption";

describe("encryption (AES-256-GCM)", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips plaintext, including unicode", () => {
    for (const plaintext of ["ya29.fake-token-value", "héllo wörld 🔐", ""]) {
      const secret = encryptSecret(plaintext);
      expect(decryptSecret(secret)).toBe(plaintext);
      expect(secret.keyVersion).toBe(CURRENT_KEY_VERSION);
    }
  });

  it("uses a fresh IV per call (same plaintext, different ciphertext)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("never stores plaintext in the encrypted shape", () => {
    const secret = encryptSecret("super-secret-refresh-token");
    expect(JSON.stringify(secret)).not.toContain("super-secret-refresh-token");
  });

  it("fails closed on tampered auth tag", () => {
    const secret = encryptSecret("data");
    const tampered = { ...secret, tag: randomBytes(16).toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow(EncryptionError);
  });

  it("fails closed on tampered ciphertext", () => {
    const secret = encryptSecret("data");
    const bytes = Buffer.from(secret.ciphertext, "base64");
    if (bytes.length > 0) bytes[0] = bytes[0] ^ 0xff;
    const tampered = { ...secret, ciphertext: bytes.toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow(EncryptionError);
  });

  it("fails closed on tampered IV", () => {
    const secret = encryptSecret("data");
    const tampered = { ...secret, iv: randomBytes(12).toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow(EncryptionError);
  });

  it("rejects a malformed IV length", () => {
    const secret = encryptSecret("data");
    const tampered = { ...secret, iv: randomBytes(4).toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow(EncryptionError);
  });

  it("throws a clean error when the key env var is missing", () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    try {
      expect(() => encryptSecret("x")).toThrow(EncryptionError);
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = saved;
    }
  });

  it("rejects a key of the wrong length", () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    try {
      expect(() => encryptSecret("x")).toThrow(EncryptionError);
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = saved;
    }
  });

  it("decryption error message leaks nothing", () => {
    const secret = encryptSecret("token-material");
    const tampered = { ...secret, tag: randomBytes(16).toString("base64") };
    try {
      decryptSecret(tampered);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("token-material");
      expect((error as Error).message).not.toContain(secret.ciphertext);
    }
  });
});
