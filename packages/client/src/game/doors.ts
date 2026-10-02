import { buildingSpriteKey, manifest } from "./assets/manifest";
import type { WorldBuilding } from "./bridge";
import type { Tile } from "./IsoMap";

/** Map tiles a building stands on (its sprite's footprint, placed from the tile behind its door). */
export function footprint(building: WorldBuilding): Tile[] {
  const info = manifest.buildings[buildingSpriteKey(building.slug, building.underConstruction)];
  return (info?.footprint ?? []).map(([dx, dy]) => ({ x: building.door.x + dx, y: building.door.y - 1 + dy }));
}

/** The building whose door is this tile: standing here offers to go in. */
export const doorAt = (buildings: WorldBuilding[], tile: Tile) => buildings.find((b) => b.door.x === tile.x && b.door.y === tile.y);

/** The building a click on this tile means: its door or any tile it stands on. */
export const buildingAt = (buildings: WorldBuilding[], tile: Tile) =>
  doorAt(buildings, tile) ?? buildings.find((b) => footprint(b).some((t) => t.x === tile.x && t.y === tile.y));
