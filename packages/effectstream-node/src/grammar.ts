import { Type } from "@sinclair/typebox";
import type { GrammarDefinition } from "@effectstream/node-sdk/concise";

/**
 * Inputs of the state machine. Every EVM event payload carries the decoded event arguments (bigints as decimal
 * strings) plus `txHash`, `logIndex` and `blockNumber` appended by AldeaEvmEventPrimitive.
 */
const logCoordinates = [
  ["txHash", Type.String()],
  ["logIndex", Type.Number()],
  ["blockNumber", Type.Number()],
] as const;

export const birthRequestedGrammar = [
  ["characterId", Type.Number()],
  ["owner", Type.String()],
  ["almaIdHash", Type.String()],
  ["characterClass", Type.Number()],
  ["targetBlock", Type.String()],
  ...logCoordinates,
] as const;

/** BirthRescheduled(uint32 indexed characterId, uint64 newTargetBlock) */
export const birthRescheduledGrammar = [["characterId", Type.Number()], ["newTargetBlock", Type.String()], ...logCoordinates] as const;

/** CharacterBorn(uint32 indexed characterId, bytes32 indexed almaIdHash, CharacterClass characterClass, Tribe tribe) */
export const birthCompletedGrammar = [
  ["characterId", Type.Number()],
  ["almaIdHash", Type.String()],
  ["characterClass", Type.Number()],
  ["tribe", Type.Number()],
  ...logCoordinates,
] as const;

/** SubjectAnchored(bytes32 indexed almaIdHash, string almaId, SubjectType subjectType, address indexed controller, bytes32 ownerIdHash, bytes32 docHash) */
export const soulAnchoredGrammar = [
  ["almaIdHash", Type.String()],
  ["almaId", Type.String()],
  ["subjectType", Type.Number()],
  ["controller", Type.String()],
  ["ownerIdHash", Type.String()],
  ["docHash", Type.String()],
  ...logCoordinates,
] as const;

export const grammar = {
  birthRequested: birthRequestedGrammar,
  birthRescheduled: birthRescheduledGrammar,
  birthCompleted: birthCompletedGrammar,
  soulAnchored: soulAnchoredGrammar,
} as const satisfies GrammarDefinition;
