/**
 * Builds the village's placeholder art from Kenney's CC0 kits (see CREDITS.md):
 *
 *   pnpm --filter client art
 *
 * 1. downloads the kits into .art-cache/ (not committed);
 * 2. renders buildings, scenery and character sheets as isometric sprites (studio.mjs: three.js in headless Chromium);
 * 3. draws the ground tileset and generates the Tiled map (map.mjs);
 * 4. writes everything to src/game/assets/ with manifest.json (sizes, anchors, footprints).
 *
 * The artist's art replaces these files in the same formats; nothing else changes.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildings as catalog } from "@aldea/shared/catalog";
import { buildings, characters, decorations, kits, tiles } from "./blueprints.mjs";
import { generateMap, TILE_H, TILE_W } from "./map.mjs";
import { openStudio, pngBuffer } from "./studio.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, "../../.art-cache");
const assets = join(here, "../../src/game/assets");

const PACKS = {
  "kenney_castle-kit": "https://kenney.nl/media/pages/assets/castle-kit/a395102d20-1711543616/kenney_castle-kit.zip",
  "kenney_fantasy-town-kit_2.0": "https://kenney.nl/media/pages/assets/fantasy-town-kit/efe948d309-1754222374/kenney_fantasy-town-kit_2.0.zip",
  "kenney_nature-kit": "https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip",
  "kenney_mini-characters": "https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip",
};

async function fetchPacks() {
  await mkdir(cache, { recursive: true });
  for (const [name, url] of Object.entries(PACKS)) {
    if (existsSync(join(cache, name))) continue;
    console.log(`downloading ${name}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const zip = join(cache, `${name}.zip`);
    await writeFile(zip, Buffer.from(await res.arrayBuffer()));
    execFileSync("unzip", ["-q", "-o", zip, "-d", join(cache, name)]);
  }
}

const url = (ref) => {
  const [kit, name] = ref.split(":");
  return `/packs/${kits[kit]}${name}.glb`;
};

async function save(path, dataUrl) {
  await mkdir(dirname(join(assets, path)), { recursive: true });
  await writeFile(join(assets, path), pngBuffer(dataUrl));
}

await fetchPacks();
const studio = await openStudio({ packs: cache });
const heights = new Map();
const height = async (ref) => {
  if (!heights.has(ref)) heights.set(ref, (await studio.boundsOf(url(ref))).max[1]);
  return heights.get(ref);
};

/** A blueprint as renderer pieces, and the map tiles it stands on. */
async function assemble(blueprint) {
  const pieces = [];
  const footprint = new Set();
  for (const part of blueprint) {
    if (part.stack) {
      let y = 0;
      for (const ref of part.stack) {
        pieces.push({ url: url(ref), pos: [part.x, y, part.z] });
        y += await height(ref);
      }
      footprint.add(`${part.x},${part.z}`);
    } else {
      pieces.push({ url: url(part.piece), pos: [part.x, part.y, part.z], rot: part.rot });
      if (part.y === 0) footprint.add(`${Math.round(part.x)},${Math.round(part.z)}`);
    }
  }
  return { pieces, footprint: [...footprint].map((cell) => cell.split(",").map(Number)) };
}

const manifest = { tile: { width: TILE_W, height: TILE_H }, tiles: tiles.map((t) => t.key), buildings: {}, decorations: {}, characters: {} };

console.log("buildings");
for (const [slug, blueprint] of Object.entries(buildings)) {
  const { pieces, footprint } = await assemble(blueprint);
  const out = await studio.render({ pieces });
  await save(`buildings/${slug}.png`, out.png);
  manifest.buildings[slug] = { width: out.width, height: out.height, anchor: out.anchor, footprint };
}

console.log("scenery");
for (const [key, decoration] of Object.entries(decorations)) {
  const out = await studio.render({ pieces: [{ url: url(decoration.piece) }] });
  await save(`decor/${key}.png`, out.png);
  manifest.decorations[key] = { width: out.width, height: out.height, anchor: out.anchor, solid: Boolean(decoration.solid) };
}

console.log("characters");
// 8 facings (row d faces d × 45° from +y of the map, turning towards +x) × [2 idle + 6 walk] frames
const FRAMES = [
  { animation: "idle", time: 0 },
  { animation: "idle", time: 0.5 },
  ...Array.from({ length: 6 }, (_, i) => ({ animation: "walk", time: i / 6 })),
];
const CHARACTER_SCALE = 1.25;
for (const [index, model] of characters.entries()) {
  const sheet = await studio.renderSheet({
    url: `/packs/${kits.chars}${model}.glb`,
    scale: CHARACTER_SCALE,
    rots: Array.from({ length: 8 }, (_, d) => d / 2),
    frames: FRAMES,
    frame: [-0.62, -0.35, 0.62, 0.95],
  });
  await save(`characters/${index}.png`, sheet.png);
  manifest.characters[index] = { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight, anchor: sheet.anchor, directions: 8, idle: [0, 1], walk: [2, 3, 4, 5, 6, 7] };
}

console.log("ground tiles and map");
await save("tiles/ground.png", (await studio.renderTileset(tiles)).png);
await studio.close();

const map = generateMap({
  tiles: tiles.map((t) => t.key),
  decorations,
  // Footprints are in blueprint space (x, z): the same axes as the map (x, y)
  buildings: catalog.map((b) => ({ slug: b.slug, door: b.door, footprint: manifest.buildings[b.slug].footprint })),
});
await mkdir(join(assets, "maps"), { recursive: true });
await writeFile(join(assets, "maps/aldea.tmj"), `${JSON.stringify(map)}\n`);
await writeFile(join(assets, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`done: ${Object.keys(manifest.buildings).length} buildings, ${Object.keys(manifest.decorations).length} scenery sprites, ${characters.length} character sheets`);
