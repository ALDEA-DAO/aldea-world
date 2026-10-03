import { Stm, type BaseStfInput } from "@effectstream/node-sdk/sm";
import type { StartConfigGameStateTransitions } from "@effectstream/node-sdk/runtime";
import { type SyncStateUpdateStream, World } from "@effectstream/node-sdk/coroutine";
import { env } from "./env.ts";
import { AldeaEvents } from "./events.ts";
import { grammar } from "./grammar.ts";
import * as atlas from "./stf/atlas.ts";
import { birthCompleted, birthRequested, birthRescheduled, type BirthCompleted, type BirthRequested, type BirthRescheduled, type Effect, type StfContext } from "./stf/births.ts";
import { buildingEntered, buildingLeft, type BuildingEntered, type BuildingLeft } from "./stf/buildings.ts";
import { soulAnchored, type SoulAnchored } from "./stf/souls.ts";

/**
 * The state transitions: each one turns an on-chain event into read-model effects (src/stf/*) and real-time events.
 * Deterministic: only World.resolve, no Date, Math.random or I/O.
 */
const stm = new Stm<typeof grammar, {}>(grammar);

function* apply(effects: Effect[]) {
  for (const [query, params] of effects) yield* World.resolve(query, params);
}

const context = (data: BaseStfInput): StfContext => ({ height: data.blockHeight, timestampMs: data.blockTimestamp, worldId: env.activityWorldId });

stm.addStateTransition("birthRequested", function* (data) {
  const input = data.parsedInput as BirthRequested;
  yield* apply(birthRequested(input, context(data)));
  data.emit(AldeaEvents.BirthUpdated, { characterId: input.characterId, status: "gestating", tribe: -1, bornTx: "" });
});

stm.addStateTransition("birthRescheduled", function* (data) {
  yield* apply(birthRescheduled(data.parsedInput as BirthRescheduled, context(data)));
});

stm.addStateTransition("birthCompleted", function* (data) {
  const input = data.parsedInput as BirthCompleted;
  yield* apply(birthCompleted(input, context(data)));
  data.emit(AldeaEvents.BirthUpdated, { characterId: input.characterId, status: "born", tribe: input.tribe, bornTx: input.txHash.toLowerCase() });
});

stm.addStateTransition("soulAnchored", function* (data) {
  yield* apply(soulAnchored(data.parsedInput as SoulAnchored));
});

stm.addStateTransition("buildingEntered", function* (data) {
  const input = data.parsedInput as BuildingEntered;
  yield* apply(buildingEntered(input, context(data)));
  data.emit(AldeaEvents.BuildingActivity, { buildingId: input.buildingId.toLowerCase(), characterId: input.characterId, kind: "entered" });
});

stm.addStateTransition("buildingLeft", function* (data) {
  const input = data.parsedInput as BuildingLeft;
  yield* apply(buildingLeft(input, context(data)));
  data.emit(AldeaEvents.BuildingActivity, { buildingId: input.buildingId.toLowerCase(), characterId: input.characterId, kind: "left" });
});

/**
 * Atlas events: the statement returns the world it changed (nothing on a replay), and that world is announced as
 * `registered` or `updated` for the Portal to refresh its row.
 */
function atlasTransition<Input>(prefix: keyof typeof grammar, effects: (input: Input) => Effect[], event: "registered" | "updated") {
  stm.addStateTransition(prefix as any, function* (data: any) {
    for (const [query, params] of effects(data.parsedInput as Input)) {
      const rows = (yield* World.resolve(query, params)) as { world_id?: string }[];
      for (const row of rows ?? []) if (row.world_id) data.emit(AldeaEvents.AtlasWorldChanged, { worldId: row.world_id, event });
    }
  });
}

atlasTransition("atlasWorldRegistered", atlas.worldRegistered, "registered");
atlasTransition("atlasVersionRegistered", atlas.versionRegistered, "updated");
atlasTransition("atlasClientRegistered", atlas.clientRegistered, "updated");
atlasTransition("atlasClientDeactivated", atlas.clientDeactivated, "updated");
atlasTransition("atlasOfficialVersionSet", atlas.officialVersionSet, "updated");
atlasTransition("atlasVersionWithdrawn", atlas.versionWithdrawn, "updated");
atlasTransition("atlasGovernorChanged", atlas.governorChanged, "updated");
atlasTransition("atlasVisibilityChanged", atlas.visibilityChanged, "updated");
atlasTransition("atlasMetadataChanged", atlas.metadataChanged, "updated");
atlasTransition("atlasVerifiedChanged", atlas.verifiedChanged, "updated");

export const gameStateTransitions: StartConfigGameStateTransitions = function* (
  _blockHeight: number,
  input: BaseStfInput,
): SyncStateUpdateStream<void> {
  yield* stm.processInput(input);
};
