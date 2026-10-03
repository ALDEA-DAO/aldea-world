import { ConfigBuilder, ConfigNetworkType, ConfigSyncProtocolType, getEvmEvent } from "@effectstream/node-sdk/config";
import { getConnection } from "@effectstream/node-sdk/db";
import { almaAnchorRegistryAbi, characterSystemAbi, movementSystemAbi } from "@aldea/shared/abis";
import { defineChain } from "viem";
import { env } from "./env.ts";
import { birthCompletedGrammar, birthRequestedGrammar, birthRescheduledGrammar, buildingEnteredGrammar, buildingLeftGrammar, soulAnchoredGrammar } from "./grammar.ts";
import { PrimitiveTypeAldeaEvmEvent } from "./primitives/evmEvent.ts";

const systems = env.systems();
const almaRegistry = env.almaRegistry();

/** An on-chain event folded into the state machine under `prefix` (see AldeaEvmEventPrimitive). */
const eventPrimitive = (name: string, contractAddress: string, abi: readonly unknown[], signature: string, grammar: unknown, prefix: string, startBlockHeight: number) =>
  ({ name, type: PrimitiveTypeAldeaEvmEvent, startBlockHeight, contractAddress, abi: getEvmEvent(abi as any, signature), grammar, stateMachinePrefix: prefix }) as any;
const MAIN_SYNC_PROTOCOL = "mainNtp";

/**
 * The NTP main clock maps Base blocks by time, and Effectstream stores `startTime` (and each chain's
 * `startBlockHeight`) as immutable config on the first run: any later change makes startup abort. On an existing
 * database we reuse the saved value; on a fresh one it comes from EFFECTSTREAM_GENESIS_MS or the current time.
 */
async function mainClockStart(): Promise<number> {
  try {
    const { rows } = await getConnection().query(
      `SELECT immutable_config->>'startTime' AS start_time FROM effectstream.sync_protocol_config_snapshot WHERE protocol_name = $1`,
      [MAIN_SYNC_PROTOCOL],
    );
    if (rows[0]?.start_time) return Number(rows[0].start_time);
  } catch {
    // fresh database: the effectstream schema does not exist yet
  }
  return env.genesisMs ?? Date.now();
}
const startTime = await mainClockStart();

const base = defineChain({
  id: env.chainId,
  name: "base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.baseRpcUrl] } },
});

/**
 * Networks and primitives: births (CharacterSystem), building visits (MovementSystem) and soul anchors
 * (AlmaAnchorRegistry). The remaining World,
 * Atlas, Council and Cardano primitives are added with their STFs in later phases.
 */
export const config = new ConfigBuilder()
  .setNamespace((b) => b.setSecurityNamespace("aldea-world"))
  .buildNetworks((b) =>
    b
      .addNetwork({ name: "ntp", type: ConfigNetworkType.NTP, startTime, blockTimeMS: 1000 })
      .addViemNetwork({ ...base, name: "base" } as any),
  )
  .buildDeployments((b) => b)
  .buildSyncProtocols((b) =>
    b
      .addMain(
        (n: any) => n.ntp,
        () => ({ name: MAIN_SYNC_PROTOCOL, type: ConfigSyncProtocolType.NTP_MAIN, chainUri: "", startBlockHeight: 1, pollingInterval: 1000 }),
      )
      .addParallel(
        (n: any) => n.base,
        (network: any) => ({
          name: "baseRpc",
          type: ConfigSyncProtocolType.EVM_RPC_PARALLEL,
          chainUri: network.rpcUrls.default.http[0],
          startBlockHeight: env.startBlock,
          pollingInterval: 500,
          confirmationDepth: env.confirmations,
        }),
      ),
  )
  .buildPrimitives((b) =>
    b
      // Systems in the aldea namespace emit from their own address, not the World's
      .addPrimitive(
        (s) => s.baseRpc,
        () =>
          eventPrimitive("CharacterBirthRequested", systems.CharacterSystem, characterSystemAbi, "CharacterBirthRequested(uint32,address,bytes32,uint8,uint64)", birthRequestedGrammar, "birthRequested", env.worldStartBlock),
      )
      .addPrimitive(
        (s) => s.baseRpc,
        () => eventPrimitive("BirthRescheduled", systems.CharacterSystem, characterSystemAbi, "BirthRescheduled(uint32,uint64)", birthRescheduledGrammar, "birthRescheduled", env.worldStartBlock),
      )
      .addPrimitive(
        (s) => s.baseRpc,
        () => eventPrimitive("CharacterBorn", systems.CharacterSystem, characterSystemAbi, "CharacterBorn(uint32,bytes32,uint8,uint8)", birthCompletedGrammar, "birthCompleted", env.worldStartBlock),
      )
      .addPrimitive(
        (s) => s.baseRpc,
        () => eventPrimitive("BuildingEntered", systems.MovementSystem, movementSystemAbi, "BuildingEntered(uint32,bytes32,bytes32)", buildingEnteredGrammar, "buildingEntered", env.worldStartBlock),
      )
      .addPrimitive(
        (s) => s.baseRpc,
        () => eventPrimitive("BuildingLeft", systems.MovementSystem, movementSystemAbi, "BuildingLeft(uint32,bytes32)", buildingLeftGrammar, "buildingLeft", env.worldStartBlock),
      )
      .addPrimitive(
        (s) => s.baseRpc,
        () =>
          eventPrimitive("SubjectAnchored", almaRegistry, almaAnchorRegistryAbi, "SubjectAnchored(bytes32,string,uint8,address,bytes32,bytes32)", soulAnchoredGrammar, "soulAnchored", env.startBlock),
      ),
  )
  .build();
