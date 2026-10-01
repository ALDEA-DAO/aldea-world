import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/node";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { createBirthChain } from "./chain";
import { createOutbox } from "./db";
import { createCompleteBirthJob } from "./jobs/completeBirth";

/**
 * Relay worker (the Midwife): executes the write intents Effectstream's STFs leave in `relay_outbox`. Today that is
 * completing births; queueing and executing Council results join later.
 *
 * The relayer key only pays gas for permissionless calls: it holds no role and little ETH.
 */
const env = process.env;
const port = Number(env.PORT ?? 8788);
const startedAt = new Date().toISOString();
const log = (message: string, context: Record<string, unknown> = {}) => console.log(JSON.stringify({ service: "relay-worker", message, ...context }));

if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN });

/** WORLD_ADDRESS, or the local deployment written by `pnpm dev` (packages/shared/src/deployments/<chainId>.json). */
function worldAddress(): Address | undefined {
  if (env.WORLD_ADDRESS) return getAddress(env.WORLD_ADDRESS);
  const path = join(dirname(fileURLToPath(import.meta.url)), `../../shared/src/deployments/${env.CHAIN_ID ?? 31337}.json`);
  const address = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { world?: { address?: string } }).world?.address : undefined;
  return address ? getAddress(address) : undefined;
}

const rpcUrl = env.BASE_RPC_URL ?? "http://127.0.0.1:8545";
const world = worldAddress();
const jobs: string[] = [];
let failing = () => 0;
let stop = () => {};

if (env.RELAYER_PRIVATE_KEY && env.DATABASE_URL && world) {
  const outbox = createOutbox(env.DATABASE_URL);
  const chain = createBirthChain({ rpcUrl, worldAddress: world, relayerKey: env.RELAYER_PRIVATE_KEY as Hex });
  const job = createCompleteBirthJob({
    outbox,
    chain,
    log,
    alert: (message, context) => {
      console.error(JSON.stringify({ service: "relay-worker", level: "alert", message, ...context }));
      Sentry.captureMessage(message, { level: "error", extra: context });
    },
  });
  const tick = () => void job.tick().catch((err: unknown) => log("tick failed", { error: err instanceof Error ? err.message : String(err) }));

  // Every new block (so a birth completes as soon as its target block exists) and every 2 s as a safety net
  const unwatch = createPublicClient({ transport: http(rpcUrl), pollingInterval: 1_000 }).watchBlockNumber({ onBlockNumber: tick, onError: () => {} });
  const timer = setInterval(tick, Number(env.POLL_MS ?? 2_000));
  stop = () => {
    unwatch();
    clearInterval(timer);
    void outbox.close();
  };
  failing = job.failing;
  jobs.push("completeBirth");
  log("the Midwife is watching the outbox", { relayer: chain.relayer, world });
} else {
  if (env.NODE_ENV === "production") throw new Error("RELAYER_PRIVATE_KEY, DATABASE_URL and WORLD_ADDRESS are required");
  log("no relayer configured: only /health is served (set RELAYER_PRIVATE_KEY, DATABASE_URL and deploy the World)");
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", startedAt, jobs, failing: failing() }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/problem+json" });
  res.end(JSON.stringify({ type: "about:blank", title: "Not found", status: 404, code: "not_found" }));
});

server.listen(port, () => log("listening", { port }));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stop();
    server.close(() => process.exit(0));
  });
}
