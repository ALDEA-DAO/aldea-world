/**
 * Checks the client's copy (packages/client/src/locales) without running the client:
 *
 *   node --experimental-strip-types scripts/lint-copy.ts
 *
 * 1. Spanish and English have the same keys, no empty text and the same {{placeholders}}.
 * 2. No banned word in what a player reads: chain jargon and speculation vocabulary (the brand's anti-patterns).
 *    "wallet" is only allowed where a player links or signs with a Cardano wallet, and in "Tus llaves".
 * 3. Every custom error of the World's systems and of AlmaAnchorRegistry has copy.
 * 4. Every problem `code` the ALMA Resolver can answer with has copy.
 * 5. Every copy key the client's code names exists.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const problems = new Set<string>();
const fail = (message: string) => void problems.add(message);

type Tree = { [key: string]: Tree | string };
function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}
const locales = { es: flatten(JSON.parse(read("packages/client/src/locales/es.json"))), en: flatten(JSON.parse(read("packages/client/src/locales/en.json"))) };

// 1. Both languages say the same things
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]).sort().join(",");
// Plural forms differ per language (`_one`, `_other`, …): compare the key they are forms of
const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");
for (const [lang, other] of [["es", "en"], ["en", "es"]] as const) {
  const otherBases = new Set([...locales[other].keys()].map(base));
  for (const [key, text] of locales[lang]) {
    if (!otherBases.has(base(key))) fail(`${lang}: "${key}" has no ${other} text`);
    if (text.trim() === "") fail(`${lang}: "${key}" is empty`);
    const twin = locales[other].get(key);
    if (twin !== undefined && placeholders(twin) !== placeholders(text)) fail(`"${key}": es and en use different {{values}}`);
  }
}

// 2. Banned words
const everywhere = [
  "gas", "nft", "nfts", "tx", "hash", "on-chain", "onchain", "smart contract", "contrato inteligente", "chainid",
  "metaverso", "metaverse", "play-to-earn", "to the moon", "floor", "apy", "web3", "blockchain",
  "últimos cupos", "last spots", "solo hoy", "today only", "no te lo pierdas", "don't miss out", "revolucionario", "revolutionary", "disruptivo", "disruptive",
];
/** Not the player's flow: the design kit (developers) and the one label that opens the technical evidence. */
const exempt = (key: string) => key.startsWith("kit.") || key === "identity.viewOnChain";
/** Where a player links or signs with a Cardano wallet, and the keys panel. */
const walletAllowed = ["founder.", "genesis.", "council.", "keys.", "registry.founderNotYet", "errors.genesisFoundersOnly"];
const has = (text: string, word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
for (const [lang, strings] of Object.entries(locales)) {
  for (const [key, raw] of strings) {
    if (exempt(key)) continue;
    const text = raw.replace(/\{\{[^}]*\}\}/g, " ");
    for (const word of everywhere) if (has(text, word)) fail(`${lang}: "${key}" says "${word}": ${raw}`);
    // "mint" in any form: mintear, minteaste, minted, minting
    if (/(^|[^\p{L}])mint/iu.test(text)) fail(`${lang}: "${key}" says "mint": ${raw}`);
    if (/wallets?/i.test(text) && !walletAllowed.some((prefix) => key.startsWith(prefix))) fail(`${lang}: "${key}" says "wallet" outside linking Cardano: ${raw}`);
    if (/\bprecio\b|\bprice\b|\bUSD\b|\$\s?\d/i.test(text)) fail(`${lang}: "${key}" mentions a price: ${raw}`);
  }
}

// 3. Contract errors
const errorNames = (file: string, filter: RegExp) => {
  const source = read(file);
  const abi = JSON.parse(source.slice(source.indexOf("["), source.lastIndexOf("]") + 1)) as { type: string; name?: string }[];
  return abi.filter((entry) => entry.type === "error" && filter.test(entry.name ?? "")).map((entry) => entry.name!);
};
const errorsSource = read("packages/client/src/lib/errors.ts");
const copyBlock = errorsSource.slice(errorsSource.indexOf("CONTRACT_ERROR_COPY"), errorsSource.indexOf("};", errorsSource.indexOf("CONTRACT_ERROR_COPY")));
const contractCopy = new Map([...copyBlock.matchAll(/^\s+(\w+): "([\w.]+)",?$/gm)].map((m) => [m[1]!, m[2]!]));
for (const name of [...errorNames("packages/shared/src/abis/generated/IWorld.ts", /System_/), ...errorNames("packages/shared/src/abis/generated/AlmaAnchorRegistry.ts", /./)]) {
  if (!contractCopy.has(name)) fail(`contract error ${name} has no copy in packages/client/src/lib/errors.ts`);
}

// 4. Resolver problem codes
function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(root, path)).isDirectory() ? files(path, ext) : ext.test(name) ? [path] : [];
  });
}
const codes = new Set<string>();
for (const file of files("packages/alma-resolver/src", /\.ts$/)) {
  const source = read(file);
  for (const m of source.matchAll(/ProblemError\(\s*\d+,\s*"([a-z0-9_]+)"/g)) codes.add(m[1]!);
  for (const m of source.matchAll(/\bcode: "([a-z0-9_]+)"/g)) codes.add(m[1]!);
}
if (codes.size < 10) fail("found almost no problem codes in packages/alma-resolver/src: has the way they are thrown changed?");
for (const code of codes) for (const lang of ["es", "en"] as const) if (!locales[lang].has(`problems.${code}`)) fail(`${lang}: problem code "${code}" has no copy (problems.${code})`);

// 5. Keys the code names
const namespaces = new Set([...locales.es.keys()].map((key) => key.split(".")[0]));
const named = new Set<string>(contractCopy.values());
for (const file of files("packages/client/src", /\.tsx?$/)) {
  for (const m of read(file).matchAll(/["'`]([a-zA-Z]+(?:\.[\w-]+)+)["'`]/g)) {
    // A string that starts like a copy key: a namespace of the locale files, then at least one more segment
    if (namespaces.has(m[1]!.split(".")[0]!) && !/\.(json|ts|tsx|css|webp|png|svg|js)$/.test(m[1]!)) named.add(m[1]!);
  }
}
const esBases = new Set([...locales.es.keys()].map(base));
const isPrefix = (key: string) => [...locales.es.keys()].some((k) => k.startsWith(`${key}.`));
for (const key of named) if (!esBases.has(key) && !isPrefix(key)) fail(`the code names "${key}", which is not in the locale files`);

if (problems.size) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error(`\n${problems.size} problem(s) in the copy`);
  process.exit(1);
}
console.log(`✓ copy: ${locales.es.size} texts in es and en, ${contractCopy.size} contract errors, ${codes.size} problem codes, ${named.size} keys named by the code`);
