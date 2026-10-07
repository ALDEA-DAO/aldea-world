import { signedInputMessage, voteInput, type CouncilChoice, type CouncilParams } from "@aldea/shared/council";
import { bech32 } from "bech32";
import { effectstreamApi, effectstreamUrl, EffectstreamError } from "../../lib/effectstream";

/** The Council as Effectstream's read model serves it, and the vote batcher. */

export const batcherUrl = import.meta.env.VITE_BATCHER_URL ?? "http://localhost:3334";

export type ProposalStatus = "scheduled" | "snapshotted" | "open" | "closed" | "queued" | "executed" | "vetoed";

export interface CouncilProposal {
  proposalId: string;
  kind: "GenesisRatification" | "SeasonElection";
  worldId: string;
  versionIds: string[];
  /** Unix seconds. */
  snapshotAt: number;
  startsAt: number;
  endsAt: number;
  status: ProposalStatus;
  paramsURI: string;
  /** Null until the proposal's rules are published for the read model. */
  paramsHash: string | null;
  params: CouncilParams | null;
  openedTx: string;
  tallyURI: string | null;
  /** Unix seconds from which a queued result can be executed. */
  eta: number | null;
  queuedTx: string | null;
  executedTx: string | null;
  vetoedTx: string | null;
  vetoReason: string | null;
}

export interface Charter {
  proposal: CouncilProposal;
  /** $ALDEA in base units, as decimal strings. */
  tally: { eligible: string; signatures: string; objections: string; participants: number };
  /** Once closed and tallied. */
  result: { outcome: "approved" | "rejected"; tallyHash: string } | null;
  /** The credential asked about: whether it sealed a Founder, its snapshot weight and its current vote. */
  voter?: { credential: string; founder: boolean; weight: string; vote: { choice: CouncilChoice; inputTx: string } | null };
}

/** The Genesis Charter of a world: its newest Genesis ratification, or null while none has been opened. */
export async function fetchCharterId(worldId: string): Promise<string | null> {
  const { items } = await effectstreamApi<{ items: CouncilProposal[] }>("/api/v1/council/proposals");
  return items.find((p) => p.kind === "GenesisRatification" && p.worldId === worldId.toLowerCase())?.proposalId ?? null;
}

export async function fetchCharter(proposalId: string, voter?: string): Promise<Charter | null> {
  try {
    return await effectstreamApi<Charter>(`/api/v1/council/proposals/${proposalId}${voter ? `?voter=${voter}` : ""}`);
  } catch (err) {
    if (err instanceof EffectstreamError && err.status === 404) return null;
    throw err;
  }
}

/** Where anyone downloads a closed proposal's full tally. */
export const tallyUrl = (proposalId: string) => `${effectstreamUrl}/api/v1/council/proposals/${proposalId}/tally.json`;

/** A CIP-30 address (hex bytes) as the bech32 text a signature names, with the credential it speaks for. */
export function signingAddress(addressHex: string): { address: string; credential: string | undefined } {
  const bytes = Uint8Array.from((addressHex.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16)));
  const type = (bytes[0] ?? 0) >> 4;
  const mainnet = ((bytes[0] ?? 0) & 0x0f) === 1;
  const reward = type === 14 || type === 15;
  const address = bech32.encode(`${reward ? "stake" : "addr"}${mainnet ? "" : "_test"}`, bech32.toWords(bytes), 200);
  const key = addressHex.slice(2, 58).toLowerCase();
  // A base address speaks for no credential: its payment key proves nothing about the stake part
  return { address, credential: bytes.length !== 29 ? undefined : type === 14 ? `stake:${key}` : type === 6 ? `pay:${key}` : undefined };
}

export interface VoteToSign {
  /** The input the state machine reads. */
  input: string;
  timestamp: number;
  address: string;
  /** The exact text the wallet signs. */
  message: string;
  /** The same text as the hex CIP-30 `signData` takes. */
  messageHex: string;
}

export function voteToSign(proposalId: string, choice: CouncilChoice, address: string, timestamp = Date.now()): VoteToSign {
  const input = voteInput(proposalId, choice);
  const message = signedInputMessage(address, timestamp, input);
  const messageHex = Array.from(new TextEncoder().encode(message), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { input, timestamp, address, message, messageHex };
}

export class BatcherError extends Error {
  constructor(readonly status: number) {
    super(`batcher: ${status}`);
  }
}

/**
 * Hands a signed vote to the batcher, which publishes it on Base and pays the gas. Resolves with the transaction that
 * carries it. No `target` is sent: the node verifies the signature without one.
 */
export async function sendVote(vote: VoteToSign, signed: { signature: string; key: string }): Promise<string | undefined> {
  const res = await fetch(`${batcherUrl}/send-input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: { address: vote.address, addressType: 1, input: vote.input, signature: `${signed.signature}+${signed.key}`, timestamp: String(vote.timestamp) },
      confirmationLevel: "wait-receipt",
    }),
  }).catch(() => undefined);
  if (!res) throw new BatcherError(0);
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; transactionHash?: string };
  if (!res.ok || body.success === false) throw new BatcherError(res.status);
  return body.transactionHash;
}
