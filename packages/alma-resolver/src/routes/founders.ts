import { randomBytes } from "node:crypto";
import { almaIdHash } from "@aldea/shared/alma";
import { MIN_FOUNDER_BALANCE } from "@aldea/shared/constants";
import { founderAttestationDomain, type FounderAttestation } from "@aldea/shared/eip712";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { hexToBytes, type Address, type Hex } from "viem";
import { bearerToken, type AlmaAccess } from "../auth/accessToken";
import type { AnyDb } from "../auth/adapter";
import { founderAttestations, links } from "../db/schema";
import type { Attestor } from "../lib/attestor";
import { ProblemError } from "../lib/problem";

/**
 * `POST /v1/founders/attestation`: the Resolver signs that the signed-in soul's linked Cardano wallet holds enough
 * $ALDEA for the Founder seal, as the read model reports it right now. The soul then presents the attestation to the
 * World itself (`aldea__claimFounder`); nothing is sent on its behalf here.
 */

export interface Holdings {
  /** Base units. */
  balance: string;
  /** Time up to which the read model has folded Cardano in, and the Cardano slot at that time. */
  asOfMs: number | null;
  asOfSlot: number | null;
}

export interface FounderRoutesDeps {
  db: AnyDb;
  verifyAccessToken: (token: string) => Promise<AlmaAccess | undefined>;
  attestor: Attestor;
  chainId: number;
  /** The World that will check the attestation; undefined until it is deployed. */
  world: () => Address | undefined;
  /** What the credential holds, or undefined when the read model cannot be reached. */
  holdings: (credential: string) => Promise<Holdings | undefined>;
  /** Whether the soul already has the seal, as the read model knows it. */
  isFounder: (almaIdHash: Hex) => Promise<boolean>;
  now?: () => number;
}

/** Holdings older than this are not attested: the wallet may have moved its $ALDEA since. */
export const MAX_HOLDINGS_AGE_MS = 30 * 60 * 1000;
export const ATTESTATION_TTL_SECONDS = 15 * 60;

export function createFounderRoutes(deps: FounderRoutesDeps) {
  const app = new Hono();
  const now = deps.now ?? Date.now;

  app.post("/attestation", async (c) => {
    const token = bearerToken(c);
    const access = token ? await deps.verifyAccessToken(token) : undefined;
    if (!access) throw new ProblemError(401, "unauthorized", "Sign in first");
    const { almaId } = access;
    const world = deps.world();
    if (!world) throw new ProblemError(503, "world_unavailable", "The world is not deployed yet");

    const soulLinks = await deps.db.select({ kind: links.kind, value: links.value, roles: links.roles }).from(links).where(and(eq(links.almaId, almaId), isNull(links.revokedAt)));
    const cardano = soulLinks.find((l) => l.kind === "cardano" && l.roles.includes("holdings"));
    if (!cardano) throw new ProblemError(409, "cardano_not_linked", "Link your Cardano wallet first");
    // The account that will send the claim: the World only accepts it from the soul's controller
    const controller = soulLinks.find((l) => l.kind === "evm" && l.roles.includes("controller"));
    if (!controller) throw new ProblemError(409, "soul_not_prepared", "Your soul has no account on Base yet", "Prepare your birth first.");
    const owner = controller.value.split(":").at(-1) as Address;
    // `cardano:stake:<hex28>` or `cardano:pay:<hex28>`
    const credential = cardano.value.slice("cardano:".length);
    const credentialHex = `0x${credential.split(":")[1]}` as Hex;

    const hash = almaIdHash(almaId);
    if (await deps.isFounder(hash).catch(() => false)) throw new ProblemError(409, "already_founder", "Your soul already has the Founder seal");

    const holdings = await deps.holdings(credential).catch(() => undefined);
    if (!holdings || holdings.asOfMs === null || holdings.asOfSlot === null || now() - holdings.asOfMs > MAX_HOLDINGS_AGE_MS) {
      throw new ProblemError(503, "holdings_stale", "We're reading Cardano", "Try again in a few minutes.");
    }
    const balance = BigInt(holdings.balance);
    if (balance < MIN_FOUNDER_BALANCE) {
      throw new ProblemError(403, "below_minimum", "Not enough $ALDEA for the seal", undefined, { balance: balance.toString(), minimum: MIN_FOUNDER_BALANCE.toString() });
    }

    const attestation: FounderAttestation = {
      owner,
      almaIdHash: hash,
      cardanoStakeCredential: credentialHex,
      aldeaBalance: balance,
      snapshotSlot: BigInt(holdings.asOfSlot),
      deadline: BigInt(Math.floor(now() / 1000) + ATTESTATION_TTL_SECONDS),
      nonce: `0x${randomBytes(32).toString("hex")}`,
    };
    const { signature, digest } = await deps.attestor.sign(deps.chainId, world, attestation);
    await deps.db.insert(founderAttestations).values({
      digest: Buffer.from(hexToBytes(digest)),
      almaId,
      ownerAddress: owner,
      stakeCredential: Buffer.from(hexToBytes(credentialHex)),
      aldeaBalance: balance.toString(),
      snapshotSlot: attestation.snapshotSlot,
      nonce: Buffer.from(hexToBytes(attestation.nonce)),
      deadline: new Date(Number(attestation.deadline) * 1000),
      signature: Buffer.from(hexToBytes(signature)),
    });

    return c.json({
      // uint128 and uint64 travel as decimal strings
      attestation: { ...attestation, aldeaBalance: balance.toString(), snapshotSlot: attestation.snapshotSlot.toString(), deadline: attestation.deadline.toString() },
      signature,
      domain: founderAttestationDomain(deps.chainId, world),
    });
  });

  return app;
}

