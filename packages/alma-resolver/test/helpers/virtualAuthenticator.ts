import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

/**
 * A software passkey (ES256, "none" attestation, user verified) that answers WebAuthn ceremonies the way a platform
 * authenticator would, so the server's verification runs unchanged.
 */
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class VirtualAuthenticator {
  private readonly credentials = new Map<string, { key: KeyObject; counter: number; userHandle: string }>();

  constructor(
    private readonly origin: string,
    private readonly rpID: string,
  ) {}

  create(options: PublicKeyCredentialCreationOptionsJSON): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const id = randomBytes(16);
    const cose = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]);
    const authData = Buffer.concat([
      sha256(this.rpID),
      Buffer.from([FLAG_UP | FLAG_UV | FLAG_AT]),
      u32(0),
      Buffer.alloc(16), // aaguid
      Buffer.from([0, id.length]),
      id,
      Buffer.from(isoCBOR.encode(cose)),
    ]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]) as never);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    this.credentials.set(b64url(id), { key: privateKey, counter: 0, userHandle: options.user.id });
    return {
      id: b64url(id),
      rawId: b64url(id),
      type: "public-key",
      response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Signs in with the first stored passkey (a discoverable credential), or throws like a browser with none. */
  get(options: PublicKeyCredentialRequestOptionsJSON): AuthenticationResponseJSON {
    const [id, credential] = [...this.credentials][0] ?? [];
    if (!id || !credential) throw Object.assign(new Error("no passkey"), { name: "NotAllowedError" });
    credential.counter += 1;
    const authData = Buffer.concat([sha256(this.rpID), Buffer.from([FLAG_UP | FLAG_UV]), u32(credential.counter)]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), credential.key);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature), userHandle: credential.userHandle },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
