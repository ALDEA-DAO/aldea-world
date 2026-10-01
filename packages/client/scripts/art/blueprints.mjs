/**
 * What gets rendered: each building as a stack of Kenney kit pieces on a 1-unit grid, plus decorations and characters.
 *
 * Coordinates are map tiles: x grows down-right on screen, z down-left, and the camera sees the faces that look
 * toward +x and +z. A building's origin (0, 0) is its front-centre tile; the building extends toward -z (away from
 * the camera) and its door tile, where a character stands to enter, is the one in front of it: (0, +1).
 */
const castle = (name) => `castle:${name}`;
const town = (name) => `town:${name}`;
const nature = (name) => `nature:${name}`;

/** A column of pieces at tile (x, z): each one sits on top of the previous. */
export const stack = (x, z, pieces, extra = {}) => ({ stack: pieces, x, z, ...extra });
/** A single piece at (x, y, z), rotated in quarter turns. */
export const at = (piece, x, y, z, rot = 0) => ({ piece, x, y, z, rot });

const cornerTower = (x, z) => stack(x, z, [castle("tower-square-base"), castle("tower-square-top")]);
const hexTower = (x, z, mids = 1) => stack(x, z, [castle("tower-hexagon-base"), ...Array(mids).fill(castle("tower-hexagon-mid")), castle("tower-hexagon-top"), castle("tower-hexagon-roof")]);

export const buildings = {
  // The hero: a walled keep with a tall blue-roofed tower
  "town-center": [
    stack(0, -1, [castle("tower-square-base"), castle("tower-square-mid-windows"), castle("tower-square-mid"), castle("tower-square-top-roof-high")]),
    cornerTower(-1, 0),
    cornerTower(1, 0),
    cornerTower(-1, -2),
    cornerTower(1, -2),
    stack(-1, -1, [castle("wall")]),
    stack(1, -1, [castle("wall")]),
    stack(0, -2, [castle("wall")]),
    stack(0, 0, [castle("bridge-straight")]),
    at(castle("flag"), -1, 1.31, 0),
    at(castle("flag"), 1, 1.31, 0),
  ],
  // A gate between two towers: the way to other worlds
  portal: [hexTower(-1, 0, 2), hexTower(1, 0, 2), stack(0, 0, [castle("bridge-straight"), castle("tower-square-arch"), castle("tower-square-top")]), at(castle("flag-banner-long"), -0.55, 0, 0.45), at(castle("flag-banner-long"), 0.55, 0, 0.45)],
  // A house with a bell tower: where souls are recorded
  "soul-registry": [stack(0, 0, [castle("tower-slant-roof")]), stack(-1, 0, [castle("tower-square-base"), castle("tower-square-mid-windows"), castle("tower-square-top-roof-rounded")]), stack(1, 0, [castle("wall")])],
  // A tall hexagonal hall between two walls
  council: [hexTower(0, 0, 3), stack(-1, 0, [castle("wall")]), stack(1, 0, [castle("wall")]), at(castle("flag"), -1, 1.31, 0), at(castle("flag"), 1, 1.31, 0)],
  // A raised archive house with an annex
  "velum-archive": [stack(0, 0, [castle("tower-square-base"), castle("tower-slant-roof")]), stack(1, 0, [town("wall-block"), town("roof-high-gable")])],
  "velum-archive-construction": [stack(0, 0, [castle("tower-square-base"), castle("tower-square-mid-open")]), stack(1, 0, [town("wall-block")]), at(castle("siege-tower"), -1.1, 0, 0, 1), at(town("planks"), 1, 1, 0)],
  // A round forge with a chimney, a stall and a cart
  "npc-forge": [stack(0, 0, [castle("tower-base"), castle("tower-top")]), at(town("chimney"), -0.3, 1.31, 0), stack(1, 0, [town("stall-green")]), at(town("cart"), -1, 0, 0.1, 1)],
  "npc-forge-construction": [stack(0, 0, [castle("tower-base")]), at(castle("siege-tower"), 1.1, 0, 0, 1), at(town("poles"), -1, 0, 0), at(town("planks"), -1, 0, 0)],
};

/** Scenery, by key. `solid` ones block walking. Each tribe's biome draws from its own list (see the map generator). */
export const decorations = {
  // village and meadow
  "tree-oak": { piece: nature("tree_oak"), solid: true },
  "tree-default": { piece: nature("tree_default"), solid: true },
  "tree-detailed": { piece: nature("tree_detailed"), solid: true },
  bush: { piece: nature("plant_bush") },
  "bush-large": { piece: nature("plant_bushLarge"), solid: true },
  "flower-red": { piece: nature("flower_redA") },
  "flower-yellow": { piece: nature("flower_yellowA") },
  "flower-purple": { piece: nature("flower_purpleA") },
  grass: { piece: nature("grass_large") },
  log: { piece: nature("log") },
  campfire: { piece: nature("campfire_stones"), solid: true },
  lantern: { piece: town("lantern"), solid: true },
  fountain: { piece: town("fountain-round"), solid: true },
  // jungle (Amazonians)
  "palm-tall": { piece: nature("tree_palmDetailedTall"), solid: true },
  "palm-bend": { piece: nature("tree_palmBend"), solid: true },
  "tree-fat": { piece: nature("tree_fat"), solid: true },
  "bush-triangle": { piece: nature("plant_bushLargeTriangle"), solid: true },
  // mountain and glacier (Himalayans)
  "pine-tall": { piece: nature("tree_pineTallA_detailed"), solid: true },
  "pine-round": { piece: nature("tree_pineRoundA"), solid: true },
  "rock-tall": { piece: nature("rock_tallA"), solid: true },
  "rock-large": { piece: nature("rock_largeA"), solid: true },
  // ocean (Poseidons)
  "stone-large": { piece: nature("stone_largeA"), solid: true },
  "stone-flat": { piece: nature("stone_smallFlatA") },
  canoe: { piece: nature("canoe"), solid: true },
  // sun and desert (Raes)
  "cactus-tall": { piece: nature("cactus_tall"), solid: true },
  "cactus-short": { piece: nature("cactus_short"), solid: true },
  "rock-small": { piece: nature("rock_smallA") },
  obelisk: { piece: nature("statue_obelisk"), solid: true },
  // tropics and coral (Tropicals)
  "palm-short": { piece: nature("tree_palmDetailedShort"), solid: true },
  "palm": { piece: nature("tree_palm"), solid: true },
  lily: { piece: nature("lily_large") },
  tent: { piece: nature("tent_detailedOpen"), solid: true },
};

/** Ground tiles, in tileset order (Tiled gid = index + 1). */
export const tiles = [
  { key: "grass", base: "#6f9f5c", speckles: ["#679657", "#78a864", "#5f8c50"] },
  { key: "jungle", base: "#3f8055", speckles: ["#37724b", "#4a8d60", "#2f6642"] },
  { key: "dirt", base: "#b48f5f", speckles: ["#a98356", "#c09a69", "#9c794e"], density: 18 },
  { key: "plaza", base: "#bdb6a6", speckles: ["#b1aa9a", "#c8c2b3", "#a59e8f"], density: 14 },
  { key: "sand", base: "#dcc68c", speckles: ["#d3bc80", "#e5d09a", "#c9b278"] },
  { key: "snow", base: "#e9eff3", speckles: ["#dfe7ed", "#f4f8fa", "#d3dde5"], density: 14 },
  { key: "water", base: "#4c8fb4", speckles: ["#4788ac", "#579abf", "#4081a5"], density: 16 },
  { key: "shallows", base: "#7dbbcd", speckles: ["#74b2c5", "#8ac6d6", "#6aa9bd"], density: 16 },
  { key: "coral", base: "#e6c9a8", speckles: ["#ddbf9d", "#efd4b5", "#e2b9a3"] },
];

/** One Mini Characters model per class (index = CharacterClass), until each class has its own art. */
export const characters = [
  "character-male-a", // Archer
  "character-female-a", // Alchemist
  "character-male-b", // Artisan
  "character-male-c", // Blacksmith
  "character-female-b", // Chef
  "character-female-c", // Magician
  "character-male-d", // Merchant
  "character-male-e", // Priest
  "character-female-d", // Tailor
  "character-female-e", // Rebel
  "character-male-f", // Warrior
];

export const kits = {
  castle: "kenney_castle-kit/Models/GLB format/",
  town: "kenney_fantasy-town-kit_2.0/Models/GLB format/",
  nature: "kenney_nature-kit/Models/GLTF format/",
  chars: "kenney_mini-characters/Models/GLB format/",
};
export { castle, town, nature };
