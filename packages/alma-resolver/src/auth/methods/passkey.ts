import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { links, passkeyCredentials } from "../../db/schema";
import { ProblemError } from "../../lib/problem";
import type { AnyDb } from "../adapter";
import type { ChallengeStore } from "../interaction";
import { findSoulByLoginKey, loginWithKey, type SoulDeps } from "../souls";

/**
 * Passkeys (WebAuthn), the primary way in. They are created on ALMA Auth's domain (the RP ID), so the same passkey
 * works in every world. "Sign in" asks for any discoverable passkey of this RP; "create my soul" registers a new one;
 * a signed-in soul can add more from ALMA Auth's "add a passkey" page. User verification is always required.
 */

export interface PasskeyConfig {
  rpID: string;
  /** Origin of the login pages (ALMA Auth's issuer origin). */
  origin: string;
}

export type PasskeyMode = "login" | "register";

const invalid = () => new ProblemError(401, "invalid_passkey", "That passkey did not work", "Try again, or use another way to sign in.");

/** Options to create a passkey; `exclude` lists the soul's passkeys so a device does not register one twice. */
export function registrationOptions(config: PasskeyConfig, exclude: string[] = []) {
  return generateRegistrationOptions({
    rpName: "ALMA",
    rpID: config.rpID,
    userName: `alma-${randomBytes(4).toString("hex")}`,
    userDisplayName: "ALMA",
    userID: randomBytes(32),
    attestationType: "none",
    excludeCredentials: exclude.map((id) => ({ id })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7, -257],
  });
}

/** Verifies a new passkey against the challenge we issued. */
export async function verifyRegistration(config: PasskeyConfig, challenge: string, response: RegistrationResponseJSON) {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: true,
  }).catch(() => undefined);
  if (!result?.verified) throw invalid();
  return result.registrationInfo;
}

export type PasskeyRegistration = Awaited<ReturnType<typeof verifyRegistration>>;

/** Stores the public key of a passkey link. */
export async function storeCredential(db: AnyDb, linkId: string, { credential, credentialBackedUp }: PasskeyRegistration) {
  await db
    .insert(passkeyCredentials)
    .values({
      credentialId: credential.id,
      linkId,
      publicKey: Buffer.from(credential.publicKey),
      signCount: credential.counter,
      transports: credential.transports ?? null,
      backedUp: credentialBackedUp,
    })
    .onConflictDoNothing();
}

export async function passkeyOptions(config: PasskeyConfig, challenges: ChallengeStore, uid: string, mode: PasskeyMode) {
  const options = mode === "register" ? await registrationOptions(config) : await generateAuthenticationOptions({ rpID: config.rpID, userVerification: "required" });
  await challenges.put(uid, "passkey", { challenge: options.challenge, mode });
  return options;
}

export async function passkeyVerify(
  config: PasskeyConfig,
  challenges: ChallengeStore,
  soulDeps: SoulDeps,
  uid: string,
  response: RegistrationResponseJSON | AuthenticationResponseJSON,
): Promise<{ almaId: string; created: boolean }> {
  const pending = await challenges.take<{ challenge: string; mode: PasskeyMode }>(uid, "passkey");
  if (!pending) throw new ProblemError(410, "challenge_expired", "The request expired", "Try again.");

  if (pending.mode === "register") {
    const registration = await verifyRegistration(config, pending.challenge, response as RegistrationResponseJSON);
    const soul = await loginWithKey(soulDeps, {
      kind: "passkey",
      value: registration.credential.id,
      proof: { type: "webauthn", verifiedAt: new Date().toISOString() },
      label: "Passkey",
    });
    const [link] = await soulDeps.db
      .select({ id: links.id })
      .from(links)
      .where(and(eq(links.kind, "passkey"), eq(links.value, registration.credential.id)))
      .limit(1);
    await storeCredential(soulDeps.db, link!.id, registration);
    return soul;
  }

  const [stored] = await soulDeps.db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.credentialId, (response as AuthenticationResponseJSON).id))
    .limit(1);
  if (!stored) throw invalid();
  const result = await verifyAuthenticationResponse({
    response: response as AuthenticationResponseJSON,
    expectedChallenge: pending.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: true,
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
