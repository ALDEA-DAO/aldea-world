import * as EasyStar from "easystarjs";
import type { IsoMap, Tile } from "./IsoMap";

/**
 * A* over the map's collision grid (easystarjs), in 8 directions without cutting corners around blocked tiles.
 * Returns the tiles to step on after `from`, or an empty path when there is no way.
 */
export class Pathfinding {
  private readonly finder = new EasyStar.js();

  constructor(private readonly map: IsoMap) {
    this.finder.setAcceptableTiles([0]);
    this.finder.enableDiagonals();
    this.finder.disableCornerCutting();
    this.finder.enableSync();
    this.refresh();
  }

  /** Call after the map's blocked tiles change (buildings placed). */
  refresh() {
    this.finder.setGrid(this.map.grid());
  }

  find(from: Tile, to: Tile): Tile[] {
    if (!this.map.walkable(to) || (from.x === to.x && from.y === to.y)) return [];
    let found: Tile[] = [];
    this.finder.findPath(from.x, from.y, to.x, to.y, (path) => {
      found = path ? path.slice(1) : [];
    });
    this.finder.calculate();
    return found;
  }
}
