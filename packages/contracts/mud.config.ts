import { defineWorld } from "@latticexyz/world";

export default defineWorld({
  namespace: "aldea",
  tables: {
    Player: {
      schema: {
        player: "address",
        id: "uint32",
        balance: "uint256",
      },
      key: ["player"]
    },
    Character: {
      schema: {
        player: "address",
        id: "uint32",
        class: "uint32",
      },
      key: ["id"]
    },
    World: {
      schema: {
        totalPopulation: "uint32",
        characterPopulation: "uint32[11]",
        tribePopulation: "uint32[5]",
      },
      key: [],
    },
  },
});
