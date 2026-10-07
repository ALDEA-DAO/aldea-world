import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aldeaCouncilExecutorAbi, atlasRegistryAbi, councilInputsAbi } from "@aldea/shared/abis";
import { paramsInput, signedInputMessage, voteInput, type CouncilChoice, type CouncilParams } from "@aldea/shared/council";
import { createPublicClient, createWalletClient, defineChain, http, toHex, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ALDEA_WORLD_ID, registerAldeaVersion } from "./atlas";
import type { Holder } from "./cardano";

/**
 * The Council on the local chain, the way the ALDEA Safe would drive it: the deployer key stands in for the Safe
 * (governor of ALDEA World in the Atlas, guardian of the executor). Opening a Charter hands the world's governor to
 * the executor, as on a public network; `restoreGovernor` takes it back so the other tests keep setting versions.
 */

const deployment = JSON.parse(readFileSync(fileURLToPath(new URL("../../shared/src/deployments/31337.json", import.meta.url)), "utf8")) as {
  councilDelay: number;
  protocol: { atlasRegistry: Hex; aldeaCouncilExecutor: Hex; councilInputs: Hex };
};
export const COUNCIL_DELAY = deployment.councilDelay;
const { atlasRegistry, aldeaCouncilExecutor: executor, councilInputs } = deployment.protocol;

// anvil's default account 0: a public development key
const SAFE = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const RPC = "http://127.0.0.1:8545";
const EFFECTSTREAM = "http://localhost:9999";
const BATCHER = "http://localhost:3334";
const COMPOSE = fileURLToPath(new URL("../../../scripts/compose.sh", import.meta.url));
const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const publicClient = createPublicClient({ chain, transport: http(), pollingInterval: 200 });
const safe = createWalletClient({ account: SAFE, chain, transport: http() });

async function asSafe(address: Hex, abi: Abi, functionName: string, args: unknown[]) {
  const { request } = await publicClient.simulateContract({ account: SAFE, address, abi, functionName, args });
  return publicClient.waitForTransactionReceipt({ hash: await safe.writeContract(request) });
}
const governor = async () => ((await publicClient.readContract({ address: atlasRegistry, abi: atlasRegistryAbi, functionName: "getWorld", args: [ALDEA_WORLD_ID] })) as { governor: Hex }).governor;

export interface Charter {
  proposalId: Hex;
  versionId: Hex;
  semver: string;
  clientCid: string;
  snapshotAt: number;
  startsAt: number;
  endsAt: number;
  params: CouncilParams;
}

export const charterParams = (excludedCredentials: string[] = []): CouncilParams => ({
  kind: "GenesisRatification",
  rule: "approved_unless_objected",
  objectionThresholdBps: 1000,
  weight: "aldea_balance_at_snapshot",
  voters: "founders_only",
  excludedCredentials,
  durationDays: 7,
});

/**
 * Opens a Genesis Charter on a new candidate version of ALDEA World, with its snapshot, start and end that many
 * seconds from now, and publishes its rules for the read model. Durations are seconds here; the real one lasts days.
 */
export async function openCharter({ snapshotIn = 5, startsIn = 10, endsIn = 60, excluded = [] as string[], publishRules = true } = {}): Promise<Charter> {
  const version = await registerAldeaVersion({ official: false });
  if ((await governor()).toLowerCase() !== executor.toLowerCase()) await asSafe(atlasRegistry, atlasRegistryAbi as Abi, "setGovernor", [ALDEA_WORLD_ID, executor]);
  const now = Number((await publicClient.getBlock()).timestamp);
  const charter: Charter = {
    proposalId: toHex(randomBytes(32)),
    versionId: version.versionId,
    semver: version.semver,
    clientCid: version.clientCid,
    snapshotAt: now + snapshotIn,
    startsAt: now + startsIn,
    endsAt: now + endsIn,
    params: charterParams(excluded),
  };
  await asSafe(executor, aldeaCouncilExecutorAbi as Abi, "openProposal", [charter.proposalId, 0, ALDEA_WORLD_ID, charter.versionId, BigInt(charter.snapshotAt), BigInt(charter.startsAt), BigInt(charter.endsAt), `ipfs://charter-${charter.semver}`]);
  if (publishRules) await publishRules_(charter);
  return charter;
}

/** The guardian publishes the Charter's rules in CouncilInputs: the read model takes them from there. */
export const publishRules_ = (charter: Pick<Charter, "proposalId" | "params">, from = SAFE) => publishInput(paramsInput(charter.proposalId, charter.params), from);

/** Any account can publish any input; who published it is what the read model looks at. */
export async function publishInput(input: string, from = SAFE) {
  const { request } = await publicClient.simulateContract({ account: from, address: councilInputs, abi: councilInputsAbi, functionName: "effectstreamSubmitGameInput", args: [toHex(input)] });
  return publicClient.waitForTransactionReceipt({ hash: await createWalletClient({ account: from, chain, transport: http() }).writeContract(request) });
}

export const veto = (proposalId: Hex, reason: string) => asSafe(executor, aldeaCouncilExecutorAbi as Abi, "veto", [proposalId, reason]);

/**
 * Gives ALDEA World's governor back to the deployer. The executor has no way to do it (on a public network that is
 * the point), so this is anvil acting as the executor.
 */
export async function restoreGovernor() {
  if ((await governor()).toLowerCase() !== executor.toLowerCase()) return;
  await publicClient.request({ method: "anvil_setBalance" as never, params: [executor, toHex(10n ** 18n)] as never });
  await publicClient.request({ method: "anvil_impersonateAccount" as never, params: [executor] as never });
  const hash = await createWalletClient({ account: executor, chain, transport: http() }).writeContract({ address: atlasRegistry, abi: atlasRegistryAbi, functionName: "setGovernor", args: [ALDEA_WORLD_ID, SAFE.address] });
  await publicClient.waitForTransactionReceipt({ hash });
  await publicClient.request({ method: "anvil_stopImpersonatingAccount" as never, params: [executor] as never });
}

/** The official version of ALDEA World in the Atlas right now. */
export const officialVersion = async () => ((await publicClient.readContract({ address: atlasRegistry, abi: atlasRegistryAbi, functionName: "officialVersionOf", args: [ALDEA_WORLD_ID] })) as readonly [Hex, unknown])[0];

/**
 * A holder's vote, signed by their wallet and sent through the batcher, as the client does. `signWith` signs with
 * another of the wallet's addresses, to try what must not count.
 */
export async function castVote(holder: Holder, proposalId: Hex, choice: CouncilChoice, { address = holder.stakeAddress, timestamp = Date.now() } = {}) {
  const input = voteInput(proposalId, choice);
  const { signature, key } = await holder.wallet.signData(signedInputMessage(address, timestamp, input), address);
  const res = await fetch(`${BATCHER}/send-input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { address, addressType: 1, input, signature: `${signature}+${key}`, timestamp: String(timestamp) }, confirmationLevel: "wait-receipt" }),
  });
  return { status: res.status, body: (await res.json()) as { success?: boolean; transactionHash?: Hex; message?: string } };
}

/** Marks a holder as a Founder in the read model alone, for voters that do not go through the browser. */
export function sealInReadModel(holder: Holder, almaIdHash: Hex) {
  const sql = `INSERT INTO founders (alma_id_hash, stake_credential, aldea_balance, snapshot_slot, claimed_block, tx_hash) VALUES ('${almaIdHash}', '${holder.credential.split(":")[1]}', 0, 0, 0, '0x') ON CONFLICT DO NOTHING`;
  execFileSync(COMPOSE, ["exec", "-T", "postgres", "psql", "-q", "-U", "aldea", "-d", "effectstream", "-c", sql], { stdio: "pipe" });
}

export interface ProposalView {
  proposal: { status: string; paramsHash: string | null; eta: number | null; tallyURI: string | null; vetoReason: string | null; queuedTx: string | null; executedTx: string | null };
  tally: { eligible: string; signatures: string; objections: string; participants: number };
  result: { outcome: string; tallyHash: Hex } | null;
  voter?: { founder: boolean; weight: string; vote: { choice: string; inputTx: string } | null };
}

export async function readProposal(proposalId: Hex, voter?: string): Promise<ProposalView | undefined> {
  const res = await fetch(`${EFFECTSTREAM}/api/v1/council/proposals/${proposalId}${voter ? `?voter=${voter}` : ""}`);
  return res.ok ? ((await res.json()) as ProposalView) : undefined;
}

export const fetchTally = async (proposalId: Hex) => (await fetch(`${EFFECTSTREAM}/api/v1/council/proposals/${proposalId}/tally.json`)).text();
