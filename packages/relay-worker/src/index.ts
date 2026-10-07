import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/node";
import { createPublicClient, formatEther, getAddress, http, type Address, type Hex } from "viem";
import { createBirthChain, createCouncilChain } from "./chain";
import { createOutbox } from "./db";
import { createCompleteBirthJob } from "./jobs/completeBirth";
import { createCouncilExecuteJob } from "./jobs/councilExecute";
import { createCouncilQueueJob } from "./jobs/councilQueue";
import { createTallyPublisher, createTallySource } from "./tally";

/**
 * Relay worker: executes the write intents Effectstream's STFs leave in `relay_outbox`. It completes births (the
 * Midwife) and takes Council results on-chain: it queues an approved one, after recomputing its tally, and executes
 * it once the delay has passed.
 *
 * The relayer key pays gas and holds one role: only it may queue a Council result. It cannot make one up (the tally
 * is public and its hash goes on-chain) and the guardian can veto whatever it queues. It keeps little ETH.
 */
const env = process.env;
const port = Number(env.PORT ?? 8788);
const startedAt = new Date().toISOString();
const log = (message: string, context: Record<string, unknown> = {}) => console.log(JSON.stringify({ service: "relay-worker", message, ...context }));

// On only with a DSN (never locally); release = the git commit the worker was built from
if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, release: env.GIT_COMMIT, environment: env.SENTRY_ENVIRONMENT ?? "production" });

/** The local deployment written by `pnpm dev` (packages/shared/src/deployments/<chainId>.json), when there is one. */
function deployment(): { world?: { address?: string }; protocol?: { aldeaCouncilExecutor?: string } } {
  const path = join(dirname(fileURLToPath(import.meta.url)), `../../shared/src/deployments/${env.CHAIN_ID ?? 31337}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}
const addressOf = (configured: string | undefined, deployed: string | undefined): Address | undefined => {
  const address = configured || deployed;
  return address ? getAddress(address) : undefined;
};

const rpcUrl = env.BASE_RPC_URL ?? "http://127.0.0.1:8545";
const world = addressOf(env.WORLD_ADDRESS, deployment().world?.address);
const council = addressOf(env.COUNCIL_ADDRESS, deployment().protocol?.aldeaCouncilExecutor);
const jobs: string[] = [];
let failing = () => 0;
let alerting = () => 0;
let stop = () => {};
/** The relayer's ETH on Base, in wei; undefined without a relayer. */
let balance: (() => Promise<bigint>) | undefined;
/** Below this the relayer is about to stop paying: 0.02 ETH unless RELAYER_MIN_BALANCE_WEI says otherwise. */
const MIN_BALANCE = BigInt(env.RELAYER_MIN_BALANCE_WEI ?? 20_000_000_000_000_000n);
/** A row of the outbox that failed three times in a row is an alert, until it stops failing. */
const FAILING_ALERT = 3;

if (env.RELAYER_PRIVATE_KEY && env.DATABASE_URL && world) {
  const outbox = createOutbox(env.DATABASE_URL);
  const chain = createBirthChain({ rpcUrl, worldAddress: world, relayerKey: env.RELAYER_PRIVATE_KEY as Hex });
  const alert = (message: string, context: Record<string, unknown>) => {
    console.error(JSON.stringify({ service: "relay-worker", level: "alert", message, ...context }));
    Sentry.captureMessage(message, { level: "error", extra: context });
  };
  const running = [createCompleteBirthJob({ outbox, chain, log, alert })];
  jobs.push("completeBirth");
  if (council) {
    const councilChain = createCouncilChain({ rpcUrl, executor: council, relayerKey: env.RELAYER_PRIVATE_KEY as Hex });
    // Where the relay reads the tally, and the address it publishes when the tally is not pinned to IPFS
    const tallies = createTallySource(env.EFFECTSTREAM_API_URL ?? "http://127.0.0.1:9999");
    const published = createTallySource(env.EFFECTSTREAM_PUBLIC_URL ?? env.EFFECTSTREAM_API_URL ?? "http://127.0.0.1:9999");
    running.push(
      createCouncilQueueJob({ outbox, chain: councilChain, fetchTally: tallies.fetchTally, publishTally: createTallyPublisher({ pinataJwt: env.PINATA_JWT, publicUrl: published.url }), log, alert }),
      createCouncilExecuteJob({ outbox, chain: councilChain, log, alert }),
    );
    jobs.push("councilQueue", "councilExecute");
  }
  const tick = () => {
    for (const job of running) void job.tick().catch((err: unknown) => log("tick failed", { error: err instanceof Error ? err.message : String(err) }));
  };

  // Every new block (so a birth completes as soon as its target block exists) and every 2 s as a safety net
  const unwatch = createPublicClient({ transport: http(rpcUrl), pollingInterval: 1_000 }).watchBlockNumber({ onBlockNumber: tick, onError: () => {} });
  const timer = setInterval(tick, Number(env.POLL_MS ?? 2_000));
  stop = () => {
    unwatch();
    clearInterval(timer);
    void outbox.close();
  };
  failing = () => running.reduce((total, job) => total + job.failing(), 0);
  alerting = () => running.reduce((total, job) => total + job.alerting(), 0);
  const reader = createPublicClient({ transport: http(rpcUrl) });
  balance = () => reader.getBalance({ address: chain.relayer });
  log("watching the outbox", { relayer: chain.relayer, world, council, jobs });
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
  // 200 while nothing is wrong, 503 with what is: an uptime monitor on this address is the alert
  if (req.method === "GET" && req.url === "/alerts") {
    void (async () => {
      const firing: { alert: string; detail: string }[] = [];
      if (alerting() > 0) firing.push({ alert: "relay_failing", detail: `${alerting()} outbox row(s) failed ${FAILING_ALERT} or more times in a row` });
      const wei = await balance?.().catch(() => undefined);
      if (wei !== undefined && wei < MIN_BALANCE) firing.push({ alert: "relayer_balance_low", detail: `${formatEther(wei)} ETH left, under ${formatEther(MIN_BALANCE)}` });
      res.writeHead(firing.length ? 503 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: firing.length === 0, alerts: firing }));
    })();
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
