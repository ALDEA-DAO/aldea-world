import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/) as unknown as z.ZodType<`0x${string}`>;
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/) as unknown as z.ZodType<`0x${string}`>;

/**
 * Addresses per chain. packages/protocol/script/Deploy.s.sol writes the protocol part and scripts/dev-deploy.sh
 * (or the staging/production deploy workflows) merge the MUD World part.
 */
export const deploymentSchema = z.object({
  chainId: z.number().int(),
  safe: address,
  relayer: address,
  councilDelay: z.number().int(),
  orgDocsCreatedAt: z.string(),
  orgs: z.record(z.string(), z.object({ almaIdHash: hex32, docHash: hex32 })),
  protocol: z.object({
    almaAnchorRegistry: address,
    atlasRegistry: address,
    aldeaCouncilExecutor: address,
    deployBlock: z.number().int(),
  }),
  world: z
    .object({
      address,
      blockNumber: z.number().int(),
      systems: z.record(z.string(), address),
    })
    .optional(),
  aldeaWorldId: hex32.optional(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

// Committed deployments (staging and production) are registered here once they exist:
// 84532.json in TASK-032 and 8453.json at the mainnet deploy.
const committed: Record<number, unknown> = {};

/**
 * Returns the deployment for a chain. Local anvil deployments (31337.json) are not committed; pass the parsed file
 * (for example read from disk in Node, or injected by Vite) as `local`.
 */
export function getDeployment(chainId: number, local?: unknown): Deployment {
  const raw = committed[chainId] ?? (chainId === 31337 ? local : undefined);
  if (raw === undefined) throw new Error(`No deployment for chain ${chainId}`);
  return deploymentSchema.parse(raw);
}
