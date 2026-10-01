/**
 * The world's ALMA organizations in the Resolver: the 5 tribes and `aldea-world`, with the same identifiers, documents
 * and hashes that were anchored on-chain by the deploy script (controller: the ALDEA Safe). Souls are members of
 * their tribe's organization, so these must exist before births are synced.
 *
 *   pnpm --filter @aldea/alma-resolver seed          # reads packages/shared/src/deployments/<BASE_CHAIN_ID>.json
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { almaIdHash, buildCoreDoc, docHash } from "@aldea/shared/alma";
import { ANCHORED_ORG_IDS } from "@aldea/shared/catalog";
import { getDeployment, type Deployment } from "@aldea/shared/deployments";
import { getAddress, hexToBytes } from "viem";
import type { AnyDb } from "../auth/adapter";
import { createDb } from "../db/client";
import { souls } from "../db/schema";

/** The deployment for a chain: committed for public networks, the local file written by `pnpm dev` for anvil. */
export function loadDeployment(chainId: number): Deployment | undefined {
  const local = join(dirname(fileURLToPath(import.meta.url)), `../../../shared/src/deployments/${chainId}.json`);
  try {
    return getDeployment(chainId, existsSync(local) ? JSON.parse(readFileSync(local, "utf8")) : undefined);
  } catch {
    return undefined;
  }
}

/**
 * Upserts the organizations as `anchored` souls. Refuses a deployment whose on-chain document hash differs from the
 * one built here: the Resolver must serve exactly the document that was anchored.
 */
export async function seedOrgs(db: AnyDb, deployment: Pick<Deployment, "chainId" | "safe" | "orgDocsCreatedAt" | "orgs">): Promise<string[]> {
  const rows = ANCHORED_ORG_IDS.map((id) => {
    const doc = buildCoreDoc({ id, type: "org", createdAt: deployment.orgDocsCreatedAt, chainId: deployment.chainId, controller: getAddress(deployment.safe) });
    const hash = docHash(doc);
    const anchored = deployment.orgs[id];
    if (!anchored) throw new Error(`${id} is not in the deployment`);
    if (anchored.docHash.toLowerCase() !== hash) throw new Error(`${id}: the anchored docHash ${anchored.docHash} does not match the document (${hash})`);
    return { almaId: id, almaIdHash: Buffer.from(hexToBytes(almaIdHash(id))), subjectType: "org" as const, status: "anchored" as const, doc, docHash: Buffer.from(hexToBytes(hash)) };
  });
  for (const row of rows) {
    await db
      .insert(souls)
      .values(row)
      .onConflictDoUpdate({ target: souls.almaId, set: { doc: row.doc, docHash: row.docHash } });
  }
  return rows.map((r) => r.almaId);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const chainId = Number(process.env.BASE_CHAIN_ID ?? 31337);
  const deployment = loadDeployment(chainId);
  if (!deployment) throw new Error(`No deployment for chain ${chainId}: deploy first`);
  const { db, client } = createDb(url);
  console.log(`alma-resolver: organizations seeded: ${(await seedOrgs(db, deployment)).join(", ")}`);
  await client.end();
}
