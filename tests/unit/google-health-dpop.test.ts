import { createHash } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GOOGLE_TOKEN_URL,
  createGoogleTokenDpopProof,
  prepareGoogleHealthDpopKey,
  restoreGoogleHealthDpopMaterial,
} from "../../src/auth/google-health-dpop";

describe("Google Health DPoP credentials", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64");
  });

  it("encrypts one P-256 private key and restores only the matching connection", async () => {
    const prepared = await prepareGoogleHealthDpopKey("connection-1");
    expect(prepared.connectionId).toBe("connection-1");
    expect(prepared.material.privateJwk).toHaveProperty("d");
    expect(prepared.material.publicJwk).not.toHaveProperty("d");
    expect(prepared.encryptedPrivateJwk.ciphertext).not.toContain(
      String(prepared.material.privateJwk.d),
    );

    const restored = await restoreGoogleHealthDpopMaterial({
      connectionId: "connection-1",
      encryptedPrivateJwk: prepared.encryptedPrivateJwk,
      nonce: "nonce-1",
      publicJwk: prepared.material.publicJwk,
      thumbprint: prepared.material.thumbprint,
    });
    expect(restored.thumbprint).toBe(prepared.material.thumbprint);
    expect(restored.nonce).toBe("nonce-1");

    await expect(
      restoreGoogleHealthDpopMaterial({
        connectionId: "other-connection",
        encryptedPrivateJwk: prepared.encryptedPrivateJwk,
        nonce: null,
        publicJwk: prepared.material.publicJwk,
        thumbprint: prepared.material.thumbprint,
      }),
    ).rejects.toThrow("Decryption failed");
  });

  it("signs an ES256 proof with the exact Google token endpoint and code hash", async () => {
    const prepared = await prepareGoogleHealthDpopKey("connection-2");
    const proof = await createGoogleTokenDpopProof(
      prepared.material,
      { kind: "authorization_code", code: "secret-code-never-in-proof" },
      "google-nonce",
    );
    const header = decodeProtectedHeader(proof);
    expect(header).toMatchObject({ alg: "ES256", typ: "dpop+jwt" });
    expect(header.jwk).toEqual(prepared.material.publicJwk);
    expect(header.jwk).not.toHaveProperty("d");

    const key = await importJWK(prepared.material.publicJwk, "ES256");
    const verified = await jwtVerify(proof, key, { algorithms: ["ES256"] });
    expect(verified.payload).toMatchObject({
      htm: "POST",
      htu: GOOGLE_TOKEN_URL,
      nonce: "google-nonce",
      jti: createHash("sha256")
        .update("secret-code-never-in-proof", "utf8")
        .digest("base64url"),
    });
    expect(JSON.stringify(decodeJwt(proof))).not.toContain("secret-code-never-in-proof");
  });

  it("uses a fresh jti for every refresh proof and detects stored key mismatch", async () => {
    const first = await prepareGoogleHealthDpopKey("connection-3");
    const second = await prepareGoogleHealthDpopKey("connection-4");
    const proof1 = await createGoogleTokenDpopProof(first.material, {
      kind: "refresh_token",
    });
    const proof2 = await createGoogleTokenDpopProof(first.material, {
      kind: "refresh_token",
    });
    expect(decodeJwt(proof1).jti).not.toBe(decodeJwt(proof2).jti);

    await expect(
      restoreGoogleHealthDpopMaterial({
        connectionId: "connection-3",
        encryptedPrivateJwk: first.encryptedPrivateJwk,
        nonce: null,
        publicJwk: second.material.publicJwk,
        thumbprint: second.material.thumbprint,
      }),
    ).rejects.toThrow("public/private key mismatch");
  });
});
