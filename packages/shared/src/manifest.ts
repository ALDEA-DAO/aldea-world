import { z } from "zod";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed bytes32");

/** Where a client serves its manifest. */
export const CLIENT_MANIFEST_PATH = ".well-known/alma-world.json";

/**
 * Client manifest served at /.well-known/alma-world.json by every client registered in the Atlas.
 *
 * It names the build's own CID and version, so it cannot be part of the build that CID covers: it is written next to
 * the build when it is published, like /version.json, and what it claims is checked against the Atlas.
 */
export const clientManifestSchema = z.object({
  schema: z.literal("alma-world-client/v1"),
  worldId: hex32,
  versionId: hex32,
  name: z.string().min(1),
  operator: z.string().regex(/^alma:main:(human|org|agent):[a-z0-9-]{1,64}$/),
  clientCid: z.string().min(1),
  gitCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  presenceUrl: z.url(),
  locale: z.array(z.string().min(2)).min(1),
});
export type ClientManifest = z.infer<typeof clientManifestSchema>;

/** Response of a manifest's presenceUrl. The Portal always labels it as self-reported. */
export const presenceSchema = z.object({
  online: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type Presence = z.infer<typeof presenceSchema>;
