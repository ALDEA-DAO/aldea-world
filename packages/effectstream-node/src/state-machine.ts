import { Stm, type BaseStfInput } from "@effectstream/node-sdk/sm";
import type { StartConfigGameStateTransitions } from "@effectstream/node-sdk/runtime";
import { type SyncStateUpdateStream, World } from "@effectstream/node-sdk/coroutine";
import { AldeaEvents } from "./events.ts";
import { grammar } from "./grammar.ts";
import { insertBirthRequested } from "./stf/births.ts";

const stm = new Stm<typeof grammar, {}>(grammar);

/** CharacterBirthRequested → births(gestating). Deterministic: only World.resolve, no Date/Math.random/IO. */
stm.addStateTransition("birthRequested", function* (data) {
  const input = data.parsedInput as {
    characterId: number;
    owner: string;
    almaIdHash: string;
    characterClass: number;
    targetBlock: string;
    txHash: string;
    blockNumber: number;
  };
  yield* World.resolve(insertBirthRequested, {
    character_id: input.characterId,
    owner: input.owner.toLowerCase(),
    alma_id_hash: input.almaIdHash.toLowerCase(),
    character_class: input.characterClass,
    target_block: input.targetBlock,
    requested_block: input.blockNumber,
    requested_tx: input.txHash.toLowerCase(),
  });
  data.emit(AldeaEvents.BirthUpdated, { characterId: input.characterId, status: "gestating", tribe: -1, bornTx: "" });
});

export const gameStateTransitions: StartConfigGameStateTransitions = function* (
  _blockHeight: number,
  input: BaseStfInput,
): SyncStateUpdateStream<void> {
  yield* stm.processInput(input);
};
