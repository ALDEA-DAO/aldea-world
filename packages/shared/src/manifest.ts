import { z } from "zod";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed bytes32");

/** Client manifest served at /.well-known/aldea-world.json (PRD § Data Model 3.7). */
export const clientManifestSchema = z.object({
  schema: z.literal("aldea-world-client/v1"),
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
