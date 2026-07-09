import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for Google OAuth tokens at rest (docs/PLAN.md
 * §"Security invariants"). Plaintext tokens must never leave this module's
 * call sites for storage — store only the EncryptedSecret triplet + key
 * version. Key rotation: add TOKEN_ENCRYPTION_KEY_V2 etc. and bump
 * CURRENT_KEY_VERSION; decrypt resolves the key by the row's keyVersion.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const CURRENT_KEY_VERSION = 1;

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64, 12 bytes
  tag: string; // base64, 16 bytes
  keyVersion: number;
}

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

function keyEnvName(version: number): string {
  return version === 1 ? "TOKEN_ENCRYPTION_KEY" : `TOKEN_ENCRYPTION_KEY_V${version}`;
}

function getKey(version: number): Buffer {
  const raw = process.env[keyEnvName(version)];
  if (!raw) {
    throw new EncryptionError(`${keyEnvName(version)} is not set`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new EncryptionError(
      `${keyEnvName(version)} must be ${KEY_BYTES} bytes of base64 (got ${key.length})`,
    );
  }
  return key;
}

export function encryptSecret(
  plaintext: string,
  keyVersion: number = CURRENT_KEY_VERSION,
): EncryptedSecret {
  const key = getKey(keyVersion);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    keyVersion,
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const key = getKey(secret.keyVersion);
  const iv = Buffer.from(secret.iv, "base64");
  const tag = Buffer.from(secret.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new EncryptionError("Malformed encrypted secret");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // Never include ciphertext or key material in the error.
    throw new EncryptionError("Decryption failed (wrong key or tampered data)");
  }
}
