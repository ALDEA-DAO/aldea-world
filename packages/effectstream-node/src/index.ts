import { init, start, type DBMigrations } from "@effectstream/node-sdk/runtime";
import { toSyncProtocolWithNetwork, withEffectstreamStaticConfig } from "@effectstream/node-sdk/config";
import { main, suspend } from "effection";
import readModelSql from "../db/migrations/0001_read_model.sql" with { type: "text" };
import { apiRouter } from "./api.ts";
import { config } from "./config.ts";
import { grammar } from "./grammar.ts";
import { AldeaEvmEventPrimitive, PrimitiveTypeAldeaEvmEvent } from "./primitives/evmEvent.ts";
import { gameStateTransitions } from "./state-machine.ts";

const migrations: DBMigrations[] = [{ name: "0001_read_model.sql", sql: readModelSql }];

// The runtime can stop on a failed query without logging why (SPIKE.md, finding 2): surface it.
process.on("uncaughtException", (e) => console.error("[effectstream-node] uncaughtException", e));
process.on("unhandledRejection", (e) => console.error("[effectstream-node] unhandledRejection", e));

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
