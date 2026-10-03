/**
 * The client's initial JavaScript budget (PRD: 250 KB gzip): the entry script and the modules it preloads, as listed
 * in packages/client/dist/index.html, gzipped. Everything loaded later (Phaser, MUD's sync, Turnkey) is not counted.
 *
 *   pnpm --filter client build && pnpm check:bundle        (BUDGET_KB overrides the budget)
 *
 * Exits 1 when the budget is exceeded.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = join(import.meta.dirname, "../packages/client/dist");
const budgetKb = Number(process.env.BUDGET_KB ?? 250);

const html = readFileSync(join(dist, "index.html"), "utf8");
const files = [...html.matchAll(/<script[^>]+src="\.?\/?([^"]+\.js)"|<link[^>]+rel="modulepreload"[^>]+href="\.?\/?([^"]+\.js)"/g)].map((m) => m[1] ?? m[2]!);
if (files.length === 0) throw new Error("No scripts found in dist/index.html: build the client first");

const sizes = files.map((file) => ({ file, gzip: gzipSync(readFileSync(join(dist, file)), { level: 9 }).length }));
const totalKb = sizes.reduce((sum, s) => sum + s.gzip, 0) / 1024;
for (const { file, gzip } of sizes.sort((a, b) => b.gzip - a.gzip)) console.log(`${(gzip / 1024).toFixed(1).padStart(7)} KB  ${file}`);
console.log(`${totalKb.toFixed(1).padStart(7)} KB  initial JavaScript (gzip), budget ${budgetKb} KB`);
if (totalKb > budgetKb) {
  console.error(`Over budget by ${(totalKb - budgetKb).toFixed(1)} KB: lazy-load what the first screen does not need.`);
  process.exit(1);
}
