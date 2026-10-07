import { init, start, type DBMigrations } from "@effectstream/node-sdk/runtime";
import { toSyncProtocolWithNetwork, withEffectstreamStaticConfig } from "@effectstream/node-sdk/config";
import { main, suspend } from "effection";
import readModelSql from "../db/migrations/0001_read_model.sql" with { type: "text" };
import visitExitsSql from "../db/migrations/0002_visit_exits.sql" with { type: "text" };
import atlasEvidenceSql from "../db/migrations/0003_atlas_evidence.sql" with { type: "text" };
import aldeaUtxosSql from "../db/migrations/0004_aldea_utxos.sql" with { type: "text" };
import councilSql from "../db/migrations/0005_council.sql" with { type: "text" };
import { apiRouter } from "./api.ts";
import { captureError, initSentry } from "./sentry.ts";
import { CARDANO_SYNC_PROTOCOL, config } from "./config.ts";
import { grammar } from "./grammar.ts";
import { AldeaEvmEventPrimitive, PrimitiveTypeAldeaEvmEvent } from "./primitives/evmEvent.ts";
import { gameStateTransitions } from "./state-machine.ts";

const migrations: DBMigrations[] = [
  { name: "0001_read_model.sql", sql: readModelSql },
  { name: "0002_visit_exits.sql", sql: visitExitsSql },
  { name: "0003_atlas_evidence.sql", sql: atlasEvidenceSql },
  { name: "0004_aldea_utxos.sql", sql: aldeaUtxosSql },
  { name: "0005_council.sql", sql: councilSql },
];

/**
 * Startup watchdog. When the runtime fails during startup (missing pg_ivm, a changed immutable config such as the
 * NTP startTime or a chain's startBlockHeight, …) it keeps the process alive without logging why. If the API is not
 * up in time, say what to check and exit so the supervisor restarts or surfaces the failure.
 *
 * A fresh database that follows Cardano is not ready until it has read the chain from the asset's first block, which
 * takes minutes: while that read advances, the node is given more time.
 */
const STARTUP_TIMEOUT_MS = Number(process.env.STARTUP_TIMEOUT_MS ?? 60_000);
const apiPort = Number(process.env.EFFECTSTREAM_API_PORT ?? 9999);
let cardanoBlock: number | undefined;
async function watchdog() {
  const health = await fetch(`http://127.0.0.1:${apiPort}/health`).then(
    async (r) => ({ ok: r.ok, body: (await r.json().catch(() => ({}))) as { protocols?: { name: string; ownBlockNumber?: number }[] } }),
    () => undefined,
  );
  if (health?.ok) return;
  const reached = health?.body.protocols?.find((p) => p.name === CARDANO_SYNC_PROTOCOL)?.ownBlockNumber;
  if (reached !== undefined && reached !== cardanoBlock) {
    cardanoBlock = reached;
    console.log(`[effectstream-node] catching up with Cardano (block ${reached})`);
    setTimeout(watchdog, STARTUP_TIMEOUT_MS).unref();
    return;
  }
  console.error(
    `[effectstream-node] startup did not complete within ${STARTUP_TIMEOUT_MS} ms. Check: the pg_ivm extension ` +
      "(or ALLOW_NO_PG_IVM=true for local Postgres), that START_BLOCK / the NTP start did not change for an existing " +
      "database (reset it after redeploying to a fresh anvil), and the database connection (DB_*).",
  );
  process.exit(1);
}
setTimeout(watchdog, STARTUP_TIMEOUT_MS).unref();

// The runtime can stop on a failed query without logging why (SPIKE.md, finding 2): surface it.
initSentry();
process.on("uncaughtException", (e) => {
  console.error("[effectstream-node] uncaughtException", e);
  captureError(e);
});
process.on("unhandledRejection", (e) => {
  console.error("[effectstream-node] unhandledRejection", e);
  captureError(e);
});

main(function* () {
  yield* init();
  // The SDK's config types do not line up with its own runtime signatures (the official templates cast too)
  yield* withEffectstreamStaticConfig(config as any, function* () {
    yield* start({
      appName: "aldea-world",
      appVersion: "0.0.0",
      syncInfo: toSyncProtocolWithNetwork(config as any),
      gameStateTransitions,
      migrations,
      apiRouter,
      grammar,
      userDefinedPrimitives: { [PrimitiveTypeAldeaEvmEvent]: AldeaEvmEventPrimitive },
    });
  });
  yield* suspend();
});
