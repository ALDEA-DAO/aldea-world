/**
 * The art studio: a headless Chromium page (renderer.html) that renders Kenney's GLB models with three.js, served from
 * a local static server. `openStudio()` returns `render(options)` (see renderer.html) and `close()`.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".glb": "model/gltf-binary", ".png": "image/png", ".json": "application/json" };

export async function openStudio({ packs }) {
  const roots = { "/three/": join(here, "../../node_modules/three/"), "/packs/": `${packs}/` };
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const mount = Object.keys(roots).find((m) => url.startsWith(m));
    const file = mount ? join(roots[mount], normalize(url.slice(mount.length))) : join(here, "renderer.html");
    if (mount && !file.startsWith(roots[mount])) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("renderer:", err.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction("window.ready === true");
  return {
    render: (options) => page.evaluate((o) => globalThis.renderSprite(o), options),
    animationsOf: (url) => page.evaluate((u) => globalThis.animationsOf(u), url),
    boundsOf: (url) => page.evaluate((u) => globalThis.boundsOf(u), url),
    renderSheet: (options) => page.evaluate((o) => globalThis.renderSheet(o), options),
    renderTileset: (tiles) => page.evaluate((t) => globalThis.renderTileset(t), tiles),
    close: async () => {
      await browser.close();
      server.close();
    },
  };
}

export const pngBuffer = (dataUrl) => Buffer.from(dataUrl.split(",")[1], "base64");
