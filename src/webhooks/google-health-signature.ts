import { createPublicKey, createVerify } from "node:crypto";

const PUBLIC_KEYSET_URL =
  "https://www.gstatic.com/googlehealthapi/webhooks/webhooks_public_keyset.json";
const KEYSET_TTL_MS = 6 * 60 * 60 * 1000;

interface TinkKey {
  keyData: {
    typeUrl: string;
    value: string;
    keyMaterialType: string;
  };
  status: string;
  keyId: number;
  outputPrefixType: string;
}

export interface TinkPublicKeyset {
  primaryKeyId: number;
  key: TinkKey[];
}

export type KeysetLoader = (forceRefresh?: boolean) => Promise<TinkPublicKeyset>;

let cachedKeyset:
  | { value: TinkPublicKeyset; expiresAt: number }
  | undefined;

function readVarint(bytes: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length && shift <= 28) {
    const byte = bytes[cursor];
    value |= (byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: cursor };
    shift += 7;
  }
  throw new Error("Malformed protobuf varint");
}

/** Extract length-delimited fields from the tiny EcdsaPublicKey protobuf. */
function protobufBytesFields(bytes: Buffer): Map<number, Buffer> {
  const fields = new Map<number, Buffer>();
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.next;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x07;
    if (wireType === 2) {
      const length = readVarint(bytes, offset);
      offset = length.next;
      const end = offset + length.value;
      if (end > bytes.length) throw new Error("Malformed protobuf field");
      fields.set(fieldNumber, bytes.subarray(offset, end));
      offset = end;
    } else if (wireType === 0) {
      offset = readVarint(bytes, offset).next;
    } else {
      throw new Error("Unsupported protobuf wire type");
    }
  }
  return fields;
}

function coordinate(bytes: Buffer): Buffer {
  if (bytes.length === 33 && bytes[0] === 0) return bytes.subarray(1);
  if (bytes.length !== 32) throw new Error("Unexpected P-256 coordinate length");
  return bytes;
}

function publicKeyFromTink(key: TinkKey) {
  if (
    key.status !== "ENABLED" ||
    key.outputPrefixType !== "TINK" ||
    key.keyData.typeUrl !== "type.googleapis.com/google.crypto.tink.EcdsaPublicKey"
  ) {
    throw new Error("Unsupported Google Health webhook key");
  }
  const fields = protobufBytesFields(Buffer.from(key.keyData.value, "base64"));
  const x = fields.get(3);
  const y = fields.get(4);
  if (!x || !y) throw new Error("Google Health webhook key is missing coordinates");
  return createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: coordinate(x).toString("base64url"),
      y: coordinate(y).toString("base64url"),
    },
    format: "jwk",
  });
}

export const loadGoogleHealthKeyset: KeysetLoader = async (forceRefresh = false) => {
  if (!forceRefresh && cachedKeyset && cachedKeyset.expiresAt > Date.now()) {
    return cachedKeyset.value;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(PUBLIC_KEYSET_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Google webhook keyset fetch failed");
    const value = (await response.json()) as TinkPublicKeyset;
    if (!Array.isArray(value.key) || value.key.length === 0) {
      throw new Error("Google webhook keyset is empty");
    }
    cachedKeyset = { value, expiresAt: Date.now() + KEYSET_TTL_MS };
    return value;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Verifies Google's Base64 Tink signature over the exact request-body bytes.
 * On an unknown key id, refresh once so 30-day key rotation takes effect
 * immediately instead of waiting for the six-hour cache TTL.
 */
export async function verifyGoogleHealthSignature(
  rawBody: Buffer,
  encodedSignature: string,
  loader: KeysetLoader = loadGoogleHealthKeyset,
): Promise<boolean> {
  let signed: Buffer;
  try {
    signed = Buffer.from(encodedSignature, "base64");
  } catch {
    return false;
  }
  if (signed.length <= 5 || signed[0] !== 0x01) return false;
  const keyId = signed.readUInt32BE(1);
  const derSignature = signed.subarray(5);

  for (const forceRefresh of [false, true]) {
    try {
      const keyset = await loader(forceRefresh);
      const key = keyset.key.find((candidate) => candidate.keyId === keyId);
      if (!key) continue;
      const verifier = createVerify("SHA256");
      verifier.update(rawBody);
      verifier.end();
      return verifier.verify(publicKeyFromTink(key), derSignature);
    } catch {
      if (forceRefresh) return false;
    }
  }
  return false;
}

export const _internal = { protobufBytesFields, publicKeyFromTink };
