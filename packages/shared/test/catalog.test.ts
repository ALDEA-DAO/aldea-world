import { describe, expect, it } from "vitest";
import mudConfig from "../../contracts/mud.config";
import { BUILDING_KINDS, buildings, CHARACTER_CLASSES, classes, TRIBES, tribes } from "../src/catalog";

describe("catalog", () => {
  it("keeps the on-chain enum order from mud.config.ts", () => {
    expect([...CHARACTER_CLASSES]).toEqual([...mudConfig.enums.CharacterClass]);
    expect([...TRIBES]).toEqual([...mudConfig.enums.Tribe]);
    expect([...BUILDING_KINDS]).toEqual([...mudConfig.enums.BuildingKind]);
  });

  it("indexes each entry by its enum position", () => {
    classes.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.enum).toBe(CHARACTER_CLASSES[i]);
    });
    tribes.forEach((t, i) => {
      expect(t.index).toBe(i);
      expect(t.enum).toBe(TRIBES[i]);
    });
    expect(classes).toHaveLength(11);
    expect(tribes).toHaveLength(5);
    expect(classes[0]?.name.es).toBe("Arquero"); // Archer is index 0 and selectable
  });

  it("derives building ids like PostDeploy.s.sol", () => {
    expect(buildings).toHaveLength(6);
    // keccak256("aldea.building.town-center"), the id PostDeploy.s.sol seeds
    expect(buildings[0]!.id).toBe("0x19e17d6a914b96b0c90e5b2791e73b5170d1f85e640ef36765706761cc396a79");
    expect(buildings.filter((b) => b.underConstruction).map((b) => b.slug)).toEqual(["velum-archive", "npc-forge"]);
    for (const b of buildings) {
      if (b.underConstruction) expect(b.construction).toBeDefined();
    }
  });
});
