import { Type } from "@sinclair/typebox";
import { genEvent, registerEvents } from "@effectstream/event-client";

/**
 * Real-time events emitted by the STFs and delivered over the node's MQTT broker after the block COMMIT
 * (a subscriber that then calls the REST API sees the matching rows).
 *
 * Effectstream builds the MQTT topic as `app/<signatureHash>/blockHeight/<n>/<indexedField>/<value>…`, so the
 * logical topics map onto indexed fields: `aldea/v1/births/{characterId}` is BirthUpdated filtered by
 * characterId, `aldea/v1/buildings/{id}/activity` is BuildingActivity filtered by buildingId, and `atlas/v1/worlds` is
 * AtlasWorldChanged (every world, or one by worldId). Clients subscribe with @effectstream/event-client's EventManager (see SPIKE.md).
 */
export const AldeaEvents = registerEvents({
  BirthUpdated: genEvent({
    name: "BirthUpdated",
    fields: [
      { name: "characterId", type: Type.Number(), indexed: true },
      { name: "status", type: Type.String() },
      // Event fields must be plain scalars (no unions/null): -1 and "" mean "not born yet"
      { name: "tribe", type: Type.Number() },
      { name: "bornTx", type: Type.String() },
    ],
  }),
  BuildingActivity: genEvent({
    name: "BuildingActivity",
    fields: [
      { name: "buildingId", type: Type.String(), indexed: true },
      { name: "characterId", type: Type.Number() },
      // "entered" or "left"
      { name: "kind", type: Type.String() },
    ],
  }),
  AtlasWorldChanged: genEvent({
    name: "AtlasWorldChanged",
    fields: [
      { name: "worldId", type: Type.String(), indexed: true },
      // "registered" or "updated" (a version, a client or any of the world's own fields)
      { name: "event", type: Type.String() },
    ],
  }),
});
