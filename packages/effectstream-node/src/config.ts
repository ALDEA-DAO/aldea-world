import { ConfigBuilder, ConfigNetworkType, ConfigSyncProtocolType, getEvmEvent } from "@effectstream/node-sdk/config";
import { getConnection } from "@effectstream/node-sdk/db";
import { characterSystemAbi } from "@aldea/shared/abis";
import { defineChain } from "viem";
import { env } from "./env.ts";
import { birthRequestedGrammar } from "./grammar.ts";
import { PrimitiveTypeAldeaEvmEvent } from "./primitives/evmEvent.ts";

const systems = env.systems();
const MAIN_SYNC_PROTOCOL = "mainNtp";

/**
 * The NTP main clock maps Base blocks by time, so its start must not move between restarts. On an existing database
 * it is recovered from the first pagination page (the pattern of the official templates); on a fresh one it comes
 * from EFFECTSTREAM_GENESIS_MS or the current time.
 */
async function mainClockStart(): Promise<number> {
  try {
    const { rows } = await getConnection().query(
      `SELECT page, page_number FROM effectstream.sync_protocol_pagination WHERE protocol_name = $1 ORDER BY page_number ASC LIMIT 1`,
      [MAIN_SYNC_PROTOCOL],
    );
    const first = rows[0];
    if (first) return Number(first.page.root) - Number(first.page_number) * 1000;
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
 * Networks and primitives (docs/prd.md § 4.6). Phase 0 syncs CharacterBirthRequested; the remaining World,
 * protocol and Cardano primitives are added with their STFs in later phases.
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
    b.addPrimitive(
      (s) => s.baseRpc,
      () =>
        ({
          name: "CharacterBirthRequested",
          type: PrimitiveTypeAldeaEvmEvent,
          startBlockHeight: env.startBlock,
          contractAddress: systems.CharacterSystem,
          abi: getEvmEvent(characterSystemAbi, "CharacterBirthRequested(uint32,address,bytes32,uint8,uint64)"),
          grammar: birthRequestedGrammar,
          stateMachinePrefix: "birthRequested",
        }) as any,
    ),
  )
  .build();
