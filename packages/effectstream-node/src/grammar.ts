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

export const grammar = {
  birthRequested: birthRequestedGrammar,
} as const satisfies GrammarDefinition;
