/**
 * Re-encodes the village's sprites (characters, buildings, scenery) as WebP (lossy with alpha, quality 0.9) in
 * headless Chromium: about a third of the PNG size, which is what a phone on 4G downloads before seeing the village.
 * Runs at the end of `pnpm art`, and alone after the artist drops new sprites as PNG into src/game/assets/:
 *
 *   pnpm --filter client art:webp
 *
 * Each `<name>.png` becomes `<name>.webp` and the PNG is removed. The ground tileset stays PNG (Tiled reads it).
 */
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const QUALITY = 0.9;
const assets = join(dirname(fileURLToPath(import.meta.url)), "../../src/game/assets");
const FOLDERS = ["characters", "buildings", "decor"];

export async function spritesToWebp() {
  const pngs = [];
  for (const folder of FOLDERS) for (const f of await readdir(join(assets, folder))) if (f.endsWith(".png")) pngs.push(join(folder, f));
  if (pngs.length === 0) return;
  const dir = assets;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let before = 0;
  let after = 0;
  for (const png of pngs) {
    const source = await readFile(join(dir, png));
    const webp = await page.evaluate(
      async ({ dataUrl, quality }) => {
        const image = new globalThis.Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        return canvas.toDataURL("image/webp", quality);
      },
      { dataUrl: `data:image/png;base64,${source.toString("base64")}`, quality: QUALITY },
    );
    if (!webp.startsWith("data:image/webp")) throw new Error(`This Chromium cannot encode WebP (${png})`);
    const out = Buffer.from(webp.split(",")[1], "base64");
    await writeFile(join(dir, png.replace(/\.png$/, ".webp")), out);
    await rm(join(dir, png));
    before += source.length;
    after += out.length;
  }
  await browser.close();
  console.log(`sprites → WebP: ${(before / 1e6).toFixed(2)} MB → ${(after / 1e6).toFixed(2)} MB`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await spritesToWebp();
