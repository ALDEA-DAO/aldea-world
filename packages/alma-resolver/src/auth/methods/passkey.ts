import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { links, passkeyCredentials } from "../../db/schema";
import { ProblemError } from "../../lib/problem";
import type { AnyDb } from "../adapter";
import type { ChallengeStore } from "../interaction";
import { findSoulByLoginKey, loginWithKey, type SoulDeps } from "../souls";

/**
 * Passkeys (WebAuthn), the primary way in. They are created on ALMA Auth's domain (the RP ID), so the same passkey
 * works in every world. "Sign in" asks for any discoverable passkey of this RP; "create my soul" registers a new one.
 * User verification is always required.
 */

export interface PasskeyConfig {
  rpID: string;
  /** Origin of the login pages (ALMA Auth's issuer origin). */
  origin: string;
}

export type PasskeyMode = "login" | "register";

export async function passkeyOptions(config: PasskeyConfig, challenges: ChallengeStore, uid: string, mode: PasskeyMode) {
  if (mode === "register") {
    const options = await generateRegistrationOptions({
      rpName: "ALMA",
      rpID: config.rpID,
      userName: `alma-${randomBytes(4).toString("hex")}`,
      userDisplayName: "ALMA",
      userID: randomBytes(32),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: [-7, -257],
    });
    await challenges.put(uid, "passkey", { challenge: options.challenge, mode });
    return options;
  }
  const options = await generateAuthenticationOptions({ rpID: config.rpID, userVerification: "required" });
  await challenges.put(uid, "passkey", { challenge: options.challenge, mode });
  return options;
}

const invalid = () => new ProblemError(401, "invalid_passkey", "That passkey did not work", "Try again, or use another way to sign in.");

export async function passkeyVerify(
  config: PasskeyConfig,
  challenges: ChallengeStore,
  soulDeps: SoulDeps,
  uid: string,
  response: RegistrationResponseJSON | AuthenticationResponseJSON,
): Promise<{ almaId: string; created: boolean }> {
  const pending = await challenges.take<{ challenge: string; mode: PasskeyMode }>(uid, "passkey");
  if (!pending) throw new ProblemError(410, "challenge_expired", "The request expired", "Try again.");
  const expected = { expectedChallenge: pending.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true };

  if (pending.mode === "register") {
    const result = await verifyRegistrationResponse({ ...expected, response: response as RegistrationResponseJSON }).catch(() => undefined);
    if (!result?.verified) throw invalid();
    const { credential, credentialBackedUp } = result.registrationInfo;
    const soul = await loginWithKey(soulDeps, {
      kind: "passkey",
      value: credential.id,
      proof: { type: "webauthn", verifiedAt: new Date().toISOString() },
      label: "Passkey",
    });
    const [link] = await soulDeps.db.select({ id: links.id }).from(links).where(eq(links.value, credential.id)).limit(1);
    await soulDeps.db
      .insert(passkeyCredentials)
      .values({
        credentialId: credential.id,
        linkId: link!.id,
        publicKey: Buffer.from(credential.publicKey),
        signCount: credential.counter,
        transports: credential.transports ?? null,
        backedUp: credentialBackedUp,
      })
      .onConflictDoNothing();
    return soul;
  }

  const stored = await findCredential(soulDeps.db, (response as AuthenticationResponseJSON).id);
  if (!stored) throw invalid();
  const result = await verifyAuthenticationResponse({
    ...expected,
    response: response as AuthenticationResponseJSON,
    credential: { id: stored.credentialId, publicKey: new Uint8Array(stored.publicKey), counter: stored.signCount, transports: stored.transports ?? undefined },
  }).catch(() => undefined);
  if (!result?.verified) throw invalid();
  await soulDeps.db
    .update(passkeyCredentials)
    .set({ signCount: result.authenticationInfo.newCounter, backedUp: result.authenticationInfo.credentialBackedUp })
    .where(eq(passkeyCredentials.credentialId, stored.credentialId));
  // A known credential only signs in: if its link was revoked, it no longer opens any soul
  const almaId = await findSoulByLoginKey(soulDeps.db, "passkey", stored.credentialId);
  if (!almaId) throw invalid();
  return { almaId, created: false };
}

async function findCredential(db: AnyDb, credentialId: string) {
  const [row] = await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.credentialId, credentialId)).limit(1);
  return row;
}
