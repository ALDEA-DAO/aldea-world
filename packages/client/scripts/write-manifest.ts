/**
 * Writes the client manifest (/.well-known/aldea-world.json) into a published copy of the build.
 *
 * Run it when publishing, after the build's CID was computed and its version registered: the manifest names both, so
 * it is not part of the files the CID covers.
 *
 *   pnpm --filter client manifest -- --dir dist --world-id 0x… --version-id 0x… --client-cid bafy… \
 *     --git-commit <sha> --presence-url https://auth.adasouls.io/v1/presence/aldea
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { CLIENT_MANIFEST_PATH, clientManifestSchema } from "@aldea/shared/manifest";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    "world-id": { type: "string" },
    "version-id": { type: "string" },
    "client-cid": { type: "string" },
    "git-commit": { type: "string" },
    "presence-url": { type: "string" },
    name: { type: "string", default: "ALDEA World" },
    operator: { type: "string", default: "alma:main:org:aldea-world" },
    locale: { type: "string", default: "es,en" },
  },
});

if (!values.dir || !statSync(values.dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error("--dir must be the published copy of the build");

const manifest = clientManifestSchema.safeParse({
  schema: "aldea-world-client/v1",
  worldId: values["world-id"],
  versionId: values["version-id"],
  name: values.name,
  operator: values.operator,
  clientCid: values["client-cid"],
  // The Atlas keeps the commit as bytes20; the manifest shows it as git does
  gitCommit: values["git-commit"]?.replace(/^0x/, "").toLowerCase(),
  presenceUrl: values["presence-url"],
  locale: values.locale.split(",").map((l) => l.trim()),
});
if (!manifest.success) {
  throw new Error(`Invalid manifest:\n${manifest.error.issues.map((issue) => `  --${String(issue.path[0]).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${issue.message}`).join("\n")}`);
}

const path = join(values.dir, CLIENT_MANIFEST_PATH);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(manifest.data, null, 2)}\n`);
console.log(path);
