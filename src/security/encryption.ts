import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

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

function getPurposeKey(version: number, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      getKey(version),
      Buffer.from("shaughv-health-mcp", "utf8"),
      Buffer.from(purpose, "utf8"),
      KEY_BYTES,
    ),
  );
}

function encryptWithKey(
  plaintext: string,
  key: Buffer,
  keyVersion: number,
  aad?: string,
): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    keyVersion,
  };
}

function decryptWithKey(secret: EncryptedSecret, key: Buffer, aad?: string): string {
  const iv = Buffer.from(secret.iv, "base64");
  const tag = Buffer.from(secret.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new EncryptionError("Malformed encrypted secret");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // Never include ciphertext, AAD, or key material in the error.
    throw new EncryptionError("Decryption failed (wrong key or tampered data)");
  }
}

export function encryptSecret(
  plaintext: string,
  keyVersion: number = CURRENT_KEY_VERSION,
): EncryptedSecret {
  return encryptWithKey(plaintext, getKey(keyVersion), keyVersion);
}

export function decryptSecret(secret: EncryptedSecret): string {
  return decryptWithKey(secret, getKey(secret.keyVersion));
}

/**
 * Encrypts structured health/cache data with a purpose-derived subkey and
 * authenticated context. The token key remains the root secret, but HKDF
 * prevents ciphertext from one storage purpose being replayed as another.
 */
export function encryptJson<T>(
  value: T,
  purpose: string,
  aad: string,
  keyVersion: number = CURRENT_KEY_VERSION,
): EncryptedSecret {
  return encryptWithKey(
    JSON.stringify(value),
    getPurposeKey(keyVersion, purpose),
    keyVersion,
    aad,
  );
}

export function decryptJson<T>(
  secret: EncryptedSecret,
  purpose: string,
  aad: string,
): T {
  const plaintext = decryptWithKey(
    secret,
    getPurposeKey(secret.keyVersion, purpose),
    aad,
  );
  try {
    return JSON.parse(plaintext) as T;
  } catch {
    throw new EncryptionError("Decrypted payload is not valid JSON");
  }
}
