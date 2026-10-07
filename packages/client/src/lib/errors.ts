import { almaAnchorRegistryAbi, worldAbi } from "@aldea/shared/abis";
import { BaseError, decodeErrorResult, isHex, type Abi, type Hex } from "viem";

/**
 * Turns a failed World or registry call into something the player can read: the contract's custom error (decoded with
 * the World's and AlmaAnchorRegistry's ABIs) mapped to a copy key under `errors.*`.
 */

export interface GameError {
  /** The custom error's name, e.g. `CharacterSystem_AlreadyHasCharacter`, or `unknown`/`network`. */
  name: string;
  args?: readonly unknown[];
  /** i18n key of the copy to show. */
  copyKey: string;
}

const abis: Abi[] = [worldAbi as Abi, almaAnchorRegistryAbi as Abi];

/** Every custom error of the World's systems and of AlmaAnchorRegistry, and the copy that says it to a player. */
export const CONTRACT_ERROR_COPY: Record<string, string> = {
  CharacterSystem_WorldPaused: "errors.worldPaused",
  CharacterSystem_AlreadyHasCharacter: "errors.alreadyHasCharacter",
  CharacterSystem_SoulAlreadyHasCharacter: "errors.alreadyHasCharacter",
  CharacterSystem_NotSoulController: "errors.notSoulController",
  CharacterSystem_NotHumanSoul: "errors.notSoulController",
  CharacterSystem_GenesisFoundersOnly: "errors.genesisFoundersOnly",
  CharacterSystem_BirthNotReady: "errors.birthNotReady",
  // Lost the completion race to the Midwife: harmless, callers ignore it
  CharacterSystem_NotGestating: "errors.unknown",
  MovementSystem_WorldPaused: "errors.worldPaused",
  MovementSystem_NoSoul: "errors.notSoulController",
  MovementSystem_NoCharacter: "errors.noCharacter",
  MovementSystem_NotBorn: "errors.notBornYet",
  MovementSystem_UnknownBuilding: "errors.unknownBuilding",
  MovementSystem_BuildingClosed: "errors.buildingClosed",
  FounderSystem_WorldPaused: "errors.worldPaused",
  FounderSystem_AlreadyFounder: "founder.errors.alreadyFounder",
  FounderSystem_StakeCredentialAlreadyClaimed: "founder.errors.credentialUsed",
  FounderSystem_BelowMinimumBalance: "founder.errors.belowMinimum",
  FounderSystem_NotSoulController: "errors.notSoulController",
  FounderSystem_AttestationOwnerMismatch: "errors.notSoulController",
  // Expired or reused attestations are replaced automatically; these only show if that fails too
  FounderSystem_AttestationExpired: "founder.errors.tryAgain",
  FounderSystem_AttestationUsed: "founder.errors.tryAgain",
  FounderSystem_InvalidAttestationSigner: "founder.errors.tryAgain",
  // Only the Safe calls AdminSystem; shown if someone else tries
  AdminSystem_InvalidConfig: "errors.notAllowed",
  AlreadyHasHuman: "errors.alreadyAnchored",
  AlreadyAnchored: "errors.alreadyAnchored",
  NoHumanSoul: "errors.needsSoul",
  NotController: "errors.notSoulController",
  SubjectRevokedError: "errors.soulRevoked",
  InvalidAlmaId: "errors.invalidSoul",
  InvalidAddress: "errors.invalidSoul",
  NotAdmin: "errors.notAllowed",
  NotIssuer: "errors.notAllowed",
};

/** Revert data anywhere in the error chain (viem nests it differently for transactions, simulations and UserOps). */
function revertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  let found: Hex | undefined;
  err.walk((e) => {
    const data = (e as { data?: unknown }).data;
    const raw = typeof data === "object" && data !== null && "data" in data ? (data as { data: unknown }).data : data;
    if (!found && typeof raw === "string" && isHex(raw) && raw.length >= 10) found = raw;
    return false;
  });
  return found;
}

export function decodeGameError(err: unknown): GameError {
  const data = revertData(err);
  if (data) {
    for (const abi of abis) {
      try {
        const { errorName, args } = decodeErrorResult({ abi, data });
        return { name: errorName, args, copyKey: CONTRACT_ERROR_COPY[errorName] ?? "errors.unknown" };
      } catch {
        // not an error of this ABI: try the next one
      }
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  // The paymaster refused to sponsor (spending limit or allowlist): the village is busy, not broken
  if (/paymaster|sponsor|AA3[0-9]|policy/i.test(message)) return { name: "sponsorship", copyKey: "errors.busy" };
  if (/fetch|network|timeout|HTTP request failed/i.test(message)) return { name: "network", copyKey: "errors.network" };
  return { name: "unknown", copyKey: "errors.unknown" };
}

/** True when the error is this custom error (e.g. a completion that lost the race to the Midwife). */
export const isGameError = (err: unknown, name: string) => decodeGameError(err).name === name;
