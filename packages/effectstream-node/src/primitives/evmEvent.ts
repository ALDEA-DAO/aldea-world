import type { StaticDecode, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { ConfigSyncProtocolType, FlattenSyncProtocolIOFor, ProtocolPrimitiveMap } from "@effectstream/node-sdk/config";
import { AddressType, type AddressAndType, type EffectstreamBlockNumber, type EvmAddress, TypeboxHelpers } from "@effectstream/node-sdk/utils";
import { Primitive } from "@effectstream/node-sdk/sm";
import { generateRawStmInput, type CommandTuple } from "@effectstream/node-sdk/concise";
import type { StateUpdateStream } from "@effectstream/node-sdk/coroutine";
import type { AbiEvent } from "viem";

type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/**
 * Generic EVM event primitive for any contract event with a custom ABI.
 *
 * Effectstream 0.200.6 ships an `EvmGenericPrimitive` but keeps `PrimitiveTypeEVMGeneric` commented out as untested
 * (packages/node-sdk/sm/primitives/src/builtin.ts), so it cannot be used as a built-in. This is the same logic
 * registered as a user-defined primitive (`userDefinedPrimitives`), plus the log coordinates the read model needs
 * for idempotency: `txHash`, `logIndex` and `blockNumber` are appended to every payload.
 * See packages/effectstream-node/SPIKE.md.
 */
export const PrimitiveTypeAldeaEvmEvent = "EVM:AldeaEvent" as const;

type Grammar = readonly Readonly<[string, TSchema]>[];

export interface AldeaEvmEventConfig {
  instanceName: string;
  startBlockHeight: number;
  contractAddress: EvmAddress;
  stateMachinePrefix: string | undefined;
  abi: AbiEvent;
  grammar: Grammar;
}

export class AldeaEvmEventPrimitive extends Primitive<ConfigSyncProtocolType.EVM_RPC_PARALLEL, Grammar> {
  readonly internalTypeName = PrimitiveTypeAldeaEvmEvent;
  readonly abi: AbiEvent;
  override grammar: Grammar;
  readonly contractAddress: EvmAddress;

  constructor(config: AldeaEvmEventConfig) {
    super(config);
    this.contractAddress = Value.Decode(TypeboxHelpers.Evm.Address, config.contractAddress);
    this.abi = config.abi;
    this.grammar = config.grammar;
  }

  override *getPayload(
    _: EffectstreamBlockNumber,
    data: FlattenSyncProtocolIOFor<ConfigSyncProtocolType.EVM_RPC_PARALLEL>,
  ): StateUpdateStream<{
    isBatched: boolean;
    data: {
      fromAddressAndType: AddressAndType;
      stateMachinePayload: StaticDecode<CommandTuple<string, any>> | null;
      accountingPayload: JsonObject;
    }[];
  }> {
    const accountingPayload = jsonSafe<JsonObject>({
      ...(data.output.payload as Record<string, unknown>),
      txHash: data.syncProtocol.transactionHash,
      logIndex: data.syncProtocol.logIndex ?? 0,
      blockNumber: data.syncProtocol.blockNumber,
    });
    const stateMachinePayload = this.stateMachinePrefix
      ? (generateRawStmInput(this.grammar, this.stateMachinePrefix, accountingPayload as any) as any)
      : null;
    return {
      isBatched: false,
      data: [{ fromAddressAndType: { type: AddressType.NONE, address: "0x0" }, accountingPayload, stateMachinePayload }],
    };
  }

  override getConfig(): ProtocolPrimitiveMap[ConfigSyncProtocolType.EVM_RPC_PARALLEL] {
    return {
      name: this.instanceName,
      type: this.internalTypeName,
      startBlockHeight: this.startBlockHeight,
      contractAddress: this.contractAddress,
      abi: this.abi,
      scheduledPrefix: this.stateMachinePrefix,
    } as any;
  }
}

/** bigint → decimal string, so payloads are JSON-serializable and deterministic. */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
