import { z } from "zod";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed bytes32");

/**
 * `/version.json`: what a published client says it is. Like the client manifest, it is written next to the build when
 * it is published (it names the build's own CID), and it is only a claim: the client checks it against the Atlas.
 */
export const versionJsonSchema = z.object({
  versionId: hex32,
  clientCid: z.string().min(1),
  gitCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  semver: z.string().min(1),
});
export type VersionJson = z.infer<typeof versionJsonSchema>;

/** AtlasRegistry.VersionStatus. */
export const VERSION_STATUS = { none: 0, candidate: 1, official: 2, superseded: 3, withdrawn: 4 } as const;

/** What the Atlas holds about the world a client was built for and about the version it claims to be. */
export interface AtlasVersionFacts {
  /** The world has a parent: it is a fork. */
  worldIsFork: boolean;
  /** The world's official version, if it has one. */
  officialVersionId: string | null;
  /** The Atlas' entry for the claimed version; `undefined` when there is no such version. */
  claimed?: { worldId: string; status: number; clientCid: string };
}

export type VersionVerdict = "official" | "candidate" | "fork" | "unofficial";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Whether a client is what it says. A fork's client is labeled as such whatever its version: the visitor is not in
 * the original world. Otherwise the claim has to be a version of this world with this CID, and it is `official` only
 * while the world's governor keeps it so; a superseded or withdrawn version, or a claim the Atlas does not back, is
 * `unofficial`. `claim` is undefined when the client serves no `/version.json`.
 */
export function classifyVersion(worldId: string, claim: VersionJson | undefined, atlas: AtlasVersionFacts): VersionVerdict {
  if (atlas.worldIsFork) return "fork";
  const entry = atlas.claimed;
  if (!claim || !entry || !same(entry.worldId, worldId) || entry.clientCid !== claim.clientCid) return "unofficial";
  if (entry.status === VERSION_STATUS.official && atlas.officialVersionId !== null && same(atlas.officialVersionId, claim.versionId)) return "official";
  if (entry.status === VERSION_STATUS.candidate) return "candidate";
  return "unofficial";
}
