/**
 * Generates the village map as a Tiled isometric map (40×40, .tmj), deterministically:
 *
 * - `ground`: the meadow with a stone plaza at the Town Center, dirt paths between the buildings' doors and one biome
 *   per tribe towards the edges (jungle, mountain and glacier, ocean, sun and desert, tropics and coral);
 * - `collision`: tiles nobody can walk on (water, building footprints, solid scenery);
 * - `decoration` and `doors`: objects with tile coordinates (`tileX`, `tileY`) the game places as sprites.
 *
 * Buildings are not in the map: the game places them from the on-chain `Building` table. Their footprints are blocked
 * here from the catalog's door coordinates, which mirror what the World is seeded with. The artist can open the file
 * in Tiled and repaint it; the layer and property names are the contract with the game.
 */
export const MAP_SIZE = 40;
export const TILE_W = 128;
export const TILE_H = 64;

/** Deterministic pseudo-random numbers (the same map on every run). */
function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const BIOMES = {
  jungle: { tile: "jungle", decor: [["palm-tall", 5], ["palm-bend", 3], ["tree-fat", 4], ["bush-triangle", 3], ["flower-purple", 2]], density: 0.2 },
  mountain: { tile: "snow", decor: [["pine-tall", 6], ["pine-round", 4], ["rock-tall", 3], ["rock-large", 3]], density: 0.17 },
  ocean: { tile: "shallows", decor: [["stone-large", 3], ["stone-flat", 3], ["canoe", 1]], density: 0.07 },
  desert: { tile: "sand", decor: [["cactus-tall", 4], ["cactus-short", 4], ["rock-small", 4], ["obelisk", 1]], density: 0.1 },
  tropics: { tile: "coral", decor: [["palm-short", 5], ["palm", 4], ["lily", 2], ["flower-red", 3], ["tent", 1]], density: 0.13 },
  meadow: { tile: "grass", decor: [["tree-oak", 3], ["tree-default", 3], ["tree-detailed", 2], ["bush", 3], ["flower-yellow", 3], ["flower-red", 2], ["grass", 5], ["log", 1]], density: 0.07 },
};

/** The biome of a tile: the village meadow in the middle, a tribe's biome towards each edge, with ragged borders. */
function biomeAt(x, y, noise) {
  const cx = x - (MAP_SIZE - 1) / 2;
  const cy = y - (MAP_SIZE - 1) / 2;
  const r = Math.hypot(cx, cy) + (noise - 0.5) * 3;
  if (r < 12.5) return "meadow";
  const angle = (Math.atan2(cy, cx) * 180) / Math.PI; // 0° = +x (down-right on screen), 90° = +y (down-left)
  if (angle >= -160 && angle < -95) return "jungle"; // top of the screen, left side
  if (angle >= -95 && angle < -20) return "mountain"; // top right
  if (angle >= -20 && angle < 50) return "ocean"; // right
  if (angle >= 50 && angle < 120) return "tropics"; // bottom
  return "desert"; // left
}

function pick(weighted, r) {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let t = r * total;
  for (const [key, w] of weighted) if ((t -= w) < 0) return key;
  return weighted[0][0];
}

/**
 * @param buildings [{ slug, door: {x, y}, footprint: [[dx, dy]…] }] — footprint cells relative to the building's origin,
 *   which is the tile behind the door: (door.x, door.y - 1)
 * @param tiles tileset keys in gid order
 * @param decorations { key: { solid } }
 */
export function generateMap({ buildings, tiles, decorations }) {
  const rnd = prng(20260927);
  const gid = (key) => tiles.indexOf(key) + 1;
  const index = (x, y) => y * MAP_SIZE + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;
  const ground = new Array(MAP_SIZE * MAP_SIZE).fill(gid("grass"));
  const blocked = new Array(MAP_SIZE * MAP_SIZE).fill(false);
  const reserved = new Array(MAP_SIZE * MAP_SIZE).fill(false); // paths, plaza, doors: no scenery
  const biome = new Array(MAP_SIZE * MAP_SIZE);

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const b = biomeAt(x, y, rnd());
      biome[index(x, y)] = b;
      ground[index(x, y)] = gid(BIOMES[b].tile);
    }
  }
  // Deep water along the ocean's outer rim: the map's edge on that side is the sea
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      if (biome[index(x, y)] === "ocean" && Math.hypot(x - 19.5, y - 19.5) > 17.5) {
        ground[index(x, y)] = gid("water");
        blocked[index(x, y)] = true;
      }
    }
  }

  // Buildings: footprints are blocked, doors stay free
  const doors = [];
  for (const b of buildings) {
    const ox = b.door.x;
    const oy = b.door.y - 1;
    for (const [dx, dy] of b.footprint) if (inside(ox + dx, oy + dy)) blocked[index(ox + dx, oy + dy)] = reserved[index(ox + dx, oy + dy)] = true;
    reserved[index(b.door.x, b.door.y)] = true;
    doors.push({ slug: b.slug, x: b.door.x, y: b.door.y });
  }

  // Plaza around the Town Center's door and dirt paths from it to every other door
  const centre = buildings.find((b) => b.slug === "town-center").door;
  const pave = (x, y, key) => {
    if (!inside(x, y) || blocked[index(x, y)]) return;
    ground[index(x, y)] = gid(key);
    reserved[index(x, y)] = true;
  };
  for (const b of buildings) {
    if (b.slug === "town-center") continue;
    let { x, y } = b.door;
    while (x !== centre.x) pave((x += Math.sign(centre.x - x)), y, "dirt");
    while (y !== centre.y + 1) pave(x, (y += Math.sign(centre.y + 1 - y)), "dirt");
    pave(b.door.x, b.door.y, "dirt");
  }
  for (let dy = 0; dy <= 4; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.abs(dx) + Math.abs(dy - 2) <= 4) pave(centre.x + dx, centre.y + dy, "plaza");

  // Scenery by biome
  const decoration = [{ key: "fountain", x: centre.x, y: centre.y + 3 }, { key: "lantern", x: centre.x - 2, y: centre.y + 1 }, { key: "lantern", x: centre.x + 2, y: centre.y + 1 }];
  for (const d of decoration) blocked[index(d.x, d.y)] = reserved[index(d.x, d.y)] = true;
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const i = index(x, y);
      const b = BIOMES[biome[i]];
      const roll = rnd();
      const choice = rnd();
      if (reserved[i] || blocked[i] || roll > b.density) continue;
      const key = pick(b.decor, choice);
      decoration.push({ key, x, y });
      if (decorations[key]?.solid) blocked[i] = true;
    }
  }

  const tileObject = (id, name, x, y, extra = []) => ({
    id,
    name,
    type: "",
    point: true,
    // Tiled places isometric objects in units of the tile height
    x: (x + 0.5) * TILE_H,
    y: (y + 0.5) * TILE_H,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    properties: [{ name: "tileX", type: "int", value: x }, { name: "tileY", type: "int", value: y }, ...extra],
  });
  let nextId = 1;
  const tileLayer = (id, name, data, visible = true) => ({ id, name, type: "tilelayer", x: 0, y: 0, width: MAP_SIZE, height: MAP_SIZE, opacity: 1, visible, data });
  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.11.0",
    orientation: "isometric",
    renderorder: "right-down",
    infinite: false,
    width: MAP_SIZE,
    height: MAP_SIZE,
    tilewidth: TILE_W,
    tileheight: TILE_H,
    nextlayerid: 5,
    nextobjectid: decoration.length + doors.length + 1,
    tilesets: [{ firstgid: 1, name: "ground", image: "../tiles/ground.png", imagewidth: TILE_W * tiles.length, imageheight: TILE_H, tilewidth: TILE_W, tileheight: TILE_H, tilecount: tiles.length, columns: tiles.length, margin: 0, spacing: 0 }],
    layers: [
      tileLayer(1, "ground", ground),
      // Any non-zero tile blocks walking (hidden: it is data, not art)
      tileLayer(2, "collision", blocked.map((b) => (b ? 1 : 0)), false),
      { id: 3, name: "decoration", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown", objects: decoration.map((d) => tileObject(nextId++, d.key, d.x, d.y)) },
      { id: 4, name: "doors", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown", objects: doors.map((d) => tileObject(nextId++, d.slug, d.x, d.y)) },
    ],
  };
}
