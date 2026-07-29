import { createHash, randomUUID } from "node:crypto";
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
} from "jose";
import {
  CURRENT_KEY_VERSION,
  decryptJson,
  encryptJson,
  type EncryptedSecret,
} from "../security/encryption";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DPOP_PRIVATE_KEY_PURPOSE = "google-health-dpop-private-jwk:v1";

export interface GoogleHealthDpopMaterial {
  privateJwk: JWK;
  publicJwk: JWK;
  thumbprint: string;
  nonce?: string;
}

export interface PreparedGoogleHealthDpopKey {
  connectionId: string;
  encryptedPrivateJwk: EncryptedSecret;
  material: GoogleHealthDpopMaterial;
}

function publicCoordinates(jwk: JWK): JWK {
  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    typeof jwk.x !== "string" ||
    typeof jwk.y !== "string"
  ) {
    throw new Error("Google Health DPoP key is not a P-256 public key");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export async function prepareGoogleHealthDpopKey(
  connectionId: string,
): Promise<PreparedGoogleHealthDpopKey> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = publicCoordinates(await exportJWK(publicKey));
  const thumbprint = await calculateJwkThumbprint(publicJwk, "sha256");
  return {
    connectionId,
    encryptedPrivateJwk: encryptJson(
      privateJwk,
      DPOP_PRIVATE_KEY_PURPOSE,
      connectionId,
      CURRENT_KEY_VERSION,
    ),
    material: { privateJwk, publicJwk, thumbprint },
  };
}

export async function restoreGoogleHealthDpopMaterial(input: {
  connectionId: string;
  encryptedPrivateJwk: EncryptedSecret;
  nonce: string | null;
  publicJwk: unknown;
  thumbprint: string;
}): Promise<GoogleHealthDpopMaterial> {
  const privateJwk = decryptJson<JWK>(
    input.encryptedPrivateJwk,
    DPOP_PRIVATE_KEY_PURPOSE,
    input.connectionId,
  );
  const privatePublic = publicCoordinates(privateJwk);
  const storedPublic = publicCoordinates(input.publicJwk as JWK);
  if (JSON.stringify(privatePublic) !== JSON.stringify(storedPublic)) {
    throw new Error("Google Health DPoP public/private key mismatch");
  }
  const thumbprint = await calculateJwkThumbprint(storedPublic, "sha256");
  if (thumbprint !== input.thumbprint) {
    throw new Error("Google Health DPoP thumbprint mismatch");
  }
  return {
    privateJwk,
    publicJwk: storedPublic,
    thumbprint,
    ...(input.nonce ? { nonce: input.nonce } : {}),
  };
}

export type GoogleDpopExchange =
  | { kind: "authorization_code"; code: string }
  | { kind: "refresh_token" };

function exchangeJti(exchange: GoogleDpopExchange): string {
  if (exchange.kind === "authorization_code") {
    return createHash("sha256").update(exchange.code, "utf8").digest("base64url");
  }
  return randomUUID();
}

export async function createGoogleTokenDpopProof(
  material: GoogleHealthDpopMaterial,
  exchange: GoogleDpopExchange,
  nonce: string | undefined = material.nonce,
): Promise<string> {
  const signingKey = await importJWK(material.privateJwk, "ES256");
  return new SignJWT({
    htm: "POST",
    htu: GOOGLE_TOKEN_URL,
    ...(nonce ? { nonce } : {}),
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: material.publicJwk,
    })
    .setJti(exchangeJti(exchange))
    .setIssuedAt()
    .sign(signingKey);
}
