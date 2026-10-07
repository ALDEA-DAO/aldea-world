import { createNewBatcher, EffectstreamL2DefaultAdapter, FileStorage, type BatcherConfig } from "@effectstream/batcher-sdk";
import { main, suspend } from "effection";
import { defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.ts";

/**
 * The vote batcher (`pnpm batcher`): Founders vote without gas. It takes inputs signed with a Cardano wallet (CIP-8)
 * on `POST /send-input`, checks each signature, and publishes them in batches in CouncilInputs, paying the gas. The
 * node reads them back from Base and checks every signature again, so the batcher can delay a vote but not forge one;
 * a voter it ignores can publish the same signed input through any other batcher.
 *
 * The namespace is part of what the voter signs and must be the node's (`aldea-world`). Inputs must not name a
 * `target`: the node verifies the signature without one.
 */
const council = env.council;
const key = process.env.BATCHER_PRIVATE_KEY as `0x${string}` | undefined;
if (!council || !key) {
  console.error("[batcher] BATCHER_PRIVATE_KEY and a deployment with CouncilInputs are required");
  process.exit(1);
}

const port = Number(process.env.BATCHER_PORT ?? 3334);
const chain = defineChain({
  id: env.chainId,
  name: "base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.baseRpcUrl] } },
});

const config: BatcherConfig = {
  namespace: "aldea-world",
  pollingIntervalMs: 500,
  enableHttpServer: true,
  port,
  // The voter gets the Base transaction that carries the vote: their evidence
  confirmationLevel: "wait-receipt",
  // A voter changes their mind a few times, not hundreds; the total covers every holder voting in a day
  rateLimit: { maxRequests: 30, globalMaxRequests: 200_000, preAuthMaxRequests: 300, windowMs: 86_400_000 },
};

main(function* () {
  const batcher = createNewBatcher(config, new FileStorage(process.env.BATCHER_DATA_DIR ?? "./.batcher-data"));
  batcher.addBlockchainAdapter("effectstream-l2", new EffectstreamL2DefaultAdapter(council.inputs, key, 0n, "baseRpc", chain as never), { criteriaType: "time", timeWindowMs: 1_000 });
  console.log(`[batcher] publishing in CouncilInputs ${council.inputs} as ${privateKeyToAccount(key).address}, listening on :${port}`);
  yield* batcher.runBatcher();
  yield* suspend();
});
