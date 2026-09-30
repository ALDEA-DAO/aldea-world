import { almaAnchorRegistryAbi, worldAbi } from "@aldea/shared/abis";
import { SPONSORED_ALMA_REGISTRY_FUNCTIONS, SPONSORED_WORLD_FUNCTIONS } from "@aldea/shared/sponsorship";
import { decodeFunctionData, getAddress, isAddress, isAddressEqual, isHex, parseAbi, toFunctionSelector, type Abi, type Address, type Hex } from "viem";
import { entryPoint06Address } from "viem/account-abstraction";

/**
 * Decides whether a UserOperation from a player's Coinbase Smart Wallet may be sponsored: every call must go to the
 * World or AlmaAnchorRegistry, to one of the sponsored functions, without ETH. The first operation may also deploy
 * the wallet, but only through the Coinbase Smart Wallet factory.
 */

// Coinbase Smart Wallet v1.1: the account's entry points (EntryPoint v0.6) and its factory
const smartWalletAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);
const ownersAbi = parseAbi(["function addOwnerAddress(address owner)"]);
export const COINBASE_SMART_WALLET_FACTORY: Address = "0xba5ed110efdba3d005bfc882d75358acbbb85842";

export interface SponsorshipTargets {
  world: Address;
  almaRegistry: Address;
}

/** The fields of a v0.6 UserOperation that decide sponsorship (JSON-RPC form). */
export interface UserOperationV06 {
  sender: string;
  initCode?: string;
  callData: string;
}

/**
 * `ownerAddition` marks the one self-call that may be sponsored: a single `addOwnerAddress(owner)` on the player's own
 * wallet. Whether it is (the owner must be a wallet the soul linked with a recent passkey) is for the caller to decide.
 */
export type SponsorshipDecision = { ok: true } | { ok: false; reason: string; ownerAddition?: Address };

function selectors(abi: Abi, names: readonly string[]): Set<Hex> {
  return new Set(
    names.map((name) => {
      const item = abi.find((i) => i.type === "function" && i.name === name);
      if (!item || item.type !== "function") throw new Error(`${name} is not in the ABI`);
      return toFunctionSelector(item);
    }),
  );
}

export function createSponsorshipPolicy(targets: SponsorshipTargets) {
  const allowed = new Map<Address, Set<Hex>>([
    [getAddress(targets.world), selectors(worldAbi as Abi, SPONSORED_WORLD_FUNCTIONS)],
    [getAddress(targets.almaRegistry), selectors(almaAnchorRegistryAbi as Abi, SPONSORED_ALMA_REGISTRY_FUNCTIONS)],
  ]);

  return function check(op: UserOperationV06): SponsorshipDecision {
    if (!isAddress(op.sender) || !isHex(op.callData)) return { ok: false, reason: "malformed UserOperation" };
    const initCode = op.initCode ?? "0x";
    if (initCode !== "0x" && !initCode.toLowerCase().startsWith(COINBASE_SMART_WALLET_FACTORY)) {
      return { ok: false, reason: "only Coinbase Smart Wallet deployments are sponsored" };
    }

    let calls: readonly { target: Address; value: bigint; data: Hex }[];
    try {
      const decoded = decodeFunctionData({ abi: smartWalletAbi, data: op.callData });
      calls = decoded.functionName === "execute" ? [{ target: decoded.args[0], value: decoded.args[1], data: decoded.args[2] }] : decoded.args[0];
    } catch {
      return { ok: false, reason: "callData is not execute or executeBatch" };
    }
    if (calls.length === 0) return { ok: false, reason: "no calls" };

    const [only] = calls;
    if (calls.length === 1 && only && isAddressEqual(only.target, op.sender as Address) && only.value === 0n) {
      try {
        const inner = decodeFunctionData({ abi: ownersAbi, data: only.data });
        if (inner.functionName === "addOwnerAddress") return { ok: false, reason: "owner changes need approval", ownerAddition: getAddress(inner.args[0]) };
      } catch {
        // not an owner change: falls through to the target check below
      }
    }

    for (const call of calls) {
      const functions = allowed.get(getAddress(call.target));
      if (!functions) return { ok: false, reason: `target ${call.target} is not sponsored` };
      if (call.value !== 0n) return { ok: false, reason: "calls with ETH are not sponsored" };
      if (!functions.has(call.data.slice(0, 10).toLowerCase() as Hex)) return { ok: false, reason: `function ${call.data.slice(0, 10)} is not sponsored` };
    }
    return { ok: true };
  };
}

export const SUPPORTED_ENTRY_POINT = entryPoint06Address;
