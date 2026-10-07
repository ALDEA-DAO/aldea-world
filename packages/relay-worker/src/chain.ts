import { aldeaCouncilExecutorAbi, worldAbi } from "@aldea/shared/abis";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The relay's view of Base: the head block and `aldea__completeBirth`, simulated before it is sent so an already
 * completed (or not yet ready) birth costs no gas.
 */

export type Simulation = "ok" | "already_completed" | "not_ready";

export interface BirthChain {
  head(): Promise<bigint>;
  simulateCompleteBirth(characterId: number): Promise<Simulation>;
  /** Sends the completion and resolves with its transaction hash once it is included. */
  completeBirth(characterId: number): Promise<Hex>;
}

const revertName = (err: unknown) => {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
};

export function createBirthChain({ rpcUrl, worldAddress, relayerKey }: { rpcUrl: string; worldAddress: Address; relayerKey: Hex }): BirthChain & { relayer: Address } {
  const account = privateKeyToAccount(relayerKey);
  // Poll every second: the default (4 s) would hold each completion's receipt, and the pass that waits for it
  const publicClient = createPublicClient({ transport: http(rpcUrl), pollingInterval: 1_000 });
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const call = (characterId: number) => ({ address: worldAddress, abi: worldAbi, functionName: "aldea__completeBirth", args: [characterId], account }) as const;

  return {
    relayer: account.address,
    head: () => publicClient.getBlockNumber(),
    async simulateCompleteBirth(characterId) {
      try {
        await publicClient.simulateContract(call(characterId));
        return "ok";
      } catch (err) {
        const name = revertName(err);
        if (name === "CharacterSystem_NotGestating") return "already_completed";
        if (name === "CharacterSystem_BirthNotReady") return "not_ready";
        throw err;
      }
    },
    async completeBirth(characterId) {
      const hash = await wallet.writeContract({ ...call(characterId), chain: null });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`completeBirth(${characterId}) reverted in ${hash}`);
      return hash;
    },
  };
}

/** What the executor would answer: `done` when the proposal is no longer in the state the call needs. */
export type CouncilSimulation = "ok" | "done" | "too_early";

/** The relay's view of AldeaCouncilExecutor: `queue` (only the relayer may) and `execute`, each simulated first. */
export interface CouncilChain {
  simulateQueue(proposalId: Hex, versionId: Hex, tallyHash: Hex, tallyURI: string): Promise<CouncilSimulation>;
  queue(proposalId: Hex, versionId: Hex, tallyHash: Hex, tallyURI: string): Promise<Hex>;
  simulateExecute(proposalId: Hex): Promise<CouncilSimulation>;
  execute(proposalId: Hex): Promise<Hex>;
}

export function createCouncilChain({ rpcUrl, executor, relayerKey }: { rpcUrl: string; executor: Address; relayerKey: Hex }): CouncilChain {
  const account = privateKeyToAccount(relayerKey);
  const publicClient = createPublicClient({ transport: http(rpcUrl), pollingInterval: 1_000 });
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const contract = { address: executor, abi: aldeaCouncilExecutorAbi, account } as const;

  const simulate = async (run: () => Promise<unknown>): Promise<CouncilSimulation> => {
    try {
      await run();
      return "ok";
    } catch (err) {
      const name = revertName(err);
      // InvalidState: already queued, executed or vetoed. TooEarly: the proposal's end or the delay has not passed on Base
      if (name === "InvalidState") return "done";
      if (name === "TooEarly") return "too_early";
      throw err;
    }
  };
  const sent = async (hash: Hex, what: string) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${what} reverted in ${hash}`);
    return hash;
  };

  return {
    simulateQueue: (proposalId, versionId, tallyHash, tallyURI) => simulate(() => publicClient.simulateContract({ ...contract, functionName: "queue", args: [proposalId, versionId, tallyHash, tallyURI] })),
    queue: async (proposalId, versionId, tallyHash, tallyURI) =>
      sent(await wallet.writeContract({ ...contract, functionName: "queue", args: [proposalId, versionId, tallyHash, tallyURI], chain: null }), `queue(${proposalId})`),
    simulateExecute: (proposalId) => simulate(() => publicClient.simulateContract({ ...contract, functionName: "execute", args: [proposalId] })),
    execute: async (proposalId) => sent(await wallet.writeContract({ ...contract, functionName: "execute", args: [proposalId], chain: null }), `execute(${proposalId})`),
  };
}
