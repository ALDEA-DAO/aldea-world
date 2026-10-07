import { randomBytes } from "node:crypto";
import { almaIdHash } from "@aldea/shared/alma";
import { founderAttestationTypes } from "@aldea/shared/eip712";
import { MeshWallet } from "@meshsdk/core";
import { eq } from "drizzle-orm";
import { bytesToHex, encodeAbiParameters, keccak256, recoverTypedDataAddress, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { cardanoSigner } from "../src/lib/cip8";
import { api, ATTESTOR_KEY, CHAIN_ID, signInWithEmail, startStack, WORLD_ADDRESS, type Stack } from "./helpers/stack";

/**
 * Founder attestations: what the Resolver signs for a soul whose linked Cardano wallet holds enough $ALDEA, and when
 * it refuses. The signature is checked the way FounderSystem.sol does: against the EIP-712 digest built by hand.
 */

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 30_000);
afterAll(() => stack.close());

const ATTESTOR = privateKeyToAccount(ATTESTOR_KEY).address;
const newEmail = () => `founder-${randomBytes(4).toString("hex")}@example.com`;

interface Attested {
  attestation: { owner: Hex; almaIdHash: Hex; cardanoStakeCredential: Hex; aldeaBalance: string; snapshotSlot: string; deadline: string; nonce: Hex };
  signature: Hex;
  domain: { name: string; version: string; chainId: number; verifyingContract: Hex };
}

/** A signed-in soul with a controller on Base and, with `balance`, a linked Cardano wallet that holds it. */
async function soul(balance?: string) {
  const tokens = await signInWithEmail(stack, newEmail());
  const me = api(stack, tokens.accessToken);
  await me.post("/v1/souls/prepare");
  if (balance === undefined) return { ...tokens, me, credential: undefined };
  const wallet = new MeshWallet({ networkId: 0, key: { type: "mnemonic", words: MeshWallet.brew() as string[] } });
  await wallet.init();
  const [stakeAddress] = await wallet.getRewardAddresses();
  const { credential } = cardanoSigner(stakeAddress!, 0);
  stack.holdings.set(credential, balance);
  const challenge = (await (await me.post("/v1/cardano/link/challenge")).json()) as { challengeId: string; payload: string };
  const linked = await me.post("/v1/cardano/link/verify", { challengeId: challenge.challengeId, address: stakeAddress, ...(await wallet.signData(challenge.payload, stakeAddress)) });
  expect(linked.status).toBe(201);
  return { ...tokens, me, credential };
}

// FounderSystem.sol's digest, spelled out
const DOMAIN_TYPEHASH = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
const FOUNDER_TYPEHASH = keccak256(toHex("FounderAttestation(address owner,bytes32 almaIdHash,bytes28 cardanoStakeCredential,uint128 aldeaBalance,uint64 snapshotSlot,uint64 deadline,bytes32 nonce)"));
function contractDigest(a: Attested["attestation"]): Hex {
  const domainSeparator = keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }], [DOMAIN_TYPEHASH, keccak256(toHex("ALDEA World")), keccak256(toHex("1")), BigInt(CHAIN_ID), WORLD_ADDRESS]),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes28" }, { type: "uint128" }, { type: "uint64" }, { type: "uint64" }, { type: "bytes32" }],
      [FOUNDER_TYPEHASH, a.owner, a.almaIdHash, a.cardanoStakeCredential, BigInt(a.aldeaBalance), BigInt(a.snapshotSlot), BigInt(a.deadline), a.nonce],
    ),
  );
  return keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}`);
}

describe("POST /v1/founders/attestation", () => {
  it("signs what the contract will check: the soul's controller, its credential, its balance and a deadline", async () => {
    const holder = await soul("1500000000");
    const res = await holder.me.post("/v1/founders/attestation");
    expect(res.status).toBe(200);
    const { attestation, signature, domain } = (await res.json()) as Attested;

    const [custody] = await stack.db.select().from(schema.custody).where(eq(schema.custody.almaId, holder.almaId));
    expect(attestation).toMatchObject({
      owner: custody!.smartAccountAddress,
      almaIdHash: almaIdHash(holder.almaId),
      cardanoStakeCredential: `0x${holder.credential!.split(":")[1]}`,
      aldeaBalance: "1500000000",
    });
    expect(Number(attestation.deadline) - Math.floor(Date.now() / 1000)).toBeGreaterThan(14 * 60);
    expect(Number(attestation.deadline) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(15 * 60);
    expect(Number(attestation.snapshotSlot)).toBeGreaterThan(135_000_000);
    expect(domain).toEqual({ name: "ALDEA World", version: "1", chainId: CHAIN_ID, verifyingContract: WORLD_ADDRESS });

    // The attestor signed it, over the same digest FounderSystem builds
    const message = { ...attestation, aldeaBalance: BigInt(attestation.aldeaBalance), snapshotSlot: BigInt(attestation.snapshotSlot), deadline: BigInt(attestation.deadline) };
    expect(await recoverTypedDataAddress({ domain, types: founderAttestationTypes, primaryType: "FounderAttestation", message, signature })).toBe(ATTESTOR);
    const [kept] = await stack.db.select().from(schema.founderAttestations).where(eq(schema.founderAttestations.almaId, holder.almaId));
    expect(bytesToHex(kept!.digest)).toBe(contractDigest(attestation));
    expect(bytesToHex(kept!.signature)).toBe(signature);
  });

  it("gives a fresh attestation each time, so an expired one can be replaced", async () => {
    const holder = await soul("1000000000");
    const first = (await (await holder.me.post("/v1/founders/attestation")).json()) as Attested;
    const second = (await (await holder.me.post("/v1/founders/attestation")).json()) as Attested;
    expect(second.attestation.nonce).not.toBe(first.attestation.nonce);
    expect(await stack.db.select().from(schema.founderAttestations).where(eq(schema.founderAttestations.almaId, holder.almaId))).toHaveLength(2);
  });

  it("refuses below the minimum, and says by how much", async () => {
    const holder = await soul("999999999");
    const res = await holder.me.post("/v1/founders/attestation");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "below_minimum", balance: "999999999", minimum: "1000000000" });
  });

  it("refuses while Cardano has not been read for more than 30 minutes, or cannot be read", async () => {
    const holder = await soul("5000000000");
    stack.cardanoRead.asOfMs = Date.now() - 31 * 60 * 1000;
    const stale = await holder.me.post("/v1/founders/attestation");
    stack.cardanoRead.asOfMs = null;
    expect(stale.status).toBe(503);
    expect(await stale.json()).toMatchObject({ code: "holdings_stale" });

    stack.holdings.delete(holder.credential!);
    expect(await (await holder.me.post("/v1/founders/attestation")).json()).toMatchObject({ code: "holdings_stale" });
    expect(await stack.db.select().from(schema.founderAttestations).where(eq(schema.founderAttestations.almaId, holder.almaId))).toEqual([]);
  });

  it("needs a linked Cardano wallet, a session, and a soul that is not a Founder yet", async () => {
    const unlinked = await soul();
    expect(await (await unlinked.me.post("/v1/founders/attestation")).json()).toMatchObject({ code: "cardano_not_linked" });
    expect((await api(stack, "nope").post("/v1/founders/attestation")).status).toBe(401);

    const founder = await soul("2000000000");
    stack.founders.add(almaIdHash(founder.almaId));
    const again = await founder.me.post("/v1/founders/attestation");
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "already_founder" });
  });
});
