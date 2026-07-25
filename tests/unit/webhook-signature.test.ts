import {
  createSign,
  generateKeyPairSync,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type TinkPublicKeyset,
  verifyGoogleHealthSignature,
} from "../../src/webhooks/google-health-signature";

function publicKeyset(keyId: number, jwk: JsonWebKey): TinkPublicKeyset {
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  const protobuf = Buffer.concat([
    Buffer.from([0x1a, x.length]),
    x,
    Buffer.from([0x22, y.length]),
    y,
  ]);
  return {
    primaryKeyId: keyId,
    key: [
      {
        keyData: {
          typeUrl: "type.googleapis.com/google.crypto.tink.EcdsaPublicKey",
          value: protobuf.toString("base64"),
          keyMaterialType: "ASYMMETRIC_PUBLIC",
        },
        status: "ENABLED",
        keyId,
        outputPrefixType: "TINK",
      },
    ],
  };
}

function signedBody(body: Buffer, keyId: number) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const signer = createSign("SHA256");
  signer.update(body);
  signer.end();
  const der = signer.sign(privateKey);
  const prefix = Buffer.alloc(5);
  prefix[0] = 0x01;
  prefix.writeUInt32BE(keyId, 1);
  return {
    signature: Buffer.concat([prefix, der]).toString("base64"),
    keyset: publicKeyset(keyId, publicKey.export({ format: "jwk" })),
  };
}

describe("Google Health webhook signature verification", () => {
  it("verifies a Tink-prefixed P-256 DER signature over exact bytes", async () => {
    const body = Buffer.from('{"data":{"healthUserId":"abc"}}');
    const { signature, keyset } = signedBody(body, 0x12345678);

    expect(
      await verifyGoogleHealthSignature(body, signature, async () => keyset),
    ).toBe(true);
  });

  it("rejects a changed raw payload", async () => {
    const body = Buffer.from('{"data":{"healthUserId":"abc"}}');
    const { signature, keyset } = signedBody(body, 0x12345678);

    expect(
      await verifyGoogleHealthSignature(
        Buffer.from('{"data":{"healthUserId":"other"}}'),
        signature,
        async () => keyset,
      ),
    ).toBe(false);
  });

  it("refreshes the rotating keyset once for an unknown key id", async () => {
    const body = Buffer.from('{"data":{"healthUserId":"abc"}}');
    const { signature, keyset } = signedBody(body, 0x12345678);
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ primaryKeyId: 1, key: [] })
      .mockResolvedValueOnce(keyset);

    expect(await verifyGoogleHealthSignature(body, signature, loader)).toBe(true);
    expect(loader).toHaveBeenNthCalledWith(1, false);
    expect(loader).toHaveBeenNthCalledWith(2, true);
  });

  it("rejects malformed prefixes and signatures", async () => {
    const loader = vi.fn();
    expect(
      await verifyGoogleHealthSignature(
        Buffer.from("{}"),
        Buffer.from([0, 1, 2, 3, 4, 5]).toString("base64"),
        loader,
      ),
    ).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });
});
