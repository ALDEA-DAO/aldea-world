# Effectstream spike

- **Date:** 2026-09-27
- **Effectstream:** 0.200.6 (npm), source at `effectstream/effectstream@817d64f`
- **Runtime:** Bun 1.4.2, anvil (Foundry 1.8.0) with `--block-time 2`, PGlite server from `@effectstream/db`
- **Time spent:** ~3 h of the 4 h budget

## Verdict: **A** (Effectstream primitives), with a user-defined generic EVM primitive

A `CharacterBirthRequested` emitted on anvil reached the `birthRequested` STF and landed in the read model:

```
$ cast send $WORLD 'aldea__requestBirth(uint8,bytes32)' 0 $(cast keccak alma:main:human:5f3c…a310)
$ curl localhost:9999/api/v1/births/1
{"characterId":1,"status":"gestating","tribe":null,"characterClass":0,"targetBlock":"107",
 "requestedTx":"0xb757caa09ca76f1f6dedccad3a1c6517ffc86069cc2311bfde2ad24da4da0d76","bornTx":null}
```

Historic events are backfilled from `START_BLOCK` on a fresh database, and a live birth was visible in the API
**4.6 s** after `cast send` returned (2 s blocks, 0 confirmations locally).

Plan B (a `viem.watchContractEvent` watcher posting to EffectstreamL2) is **not needed**.

## Findings: packages, primitives and sync

### Packages

All packages are published under `@effectstream/*` at the same version (0.200.6). The umbrella
**`@effectstream/node-sdk`** re-exports everything a node needs through subpaths, so it is the only dependency:

| Subpath | Instead of | Used for |
|---|---|---|
| `@effectstream/node-sdk/config` | `@effectstream/config` | `ConfigBuilder`, `ConfigNetworkType`, `ConfigSyncProtocolType`, `getEvmEvent`, `withEffectstreamStaticConfig` |
| `@effectstream/node-sdk/sm` | `@effectstream/sm` | `Stm`, `Primitive` (base class for custom primitives) |
| `@effectstream/node-sdk/sm/builtin` | `@effectstream/sm/builtin` | `PrimitiveTypeEVMEffectstreamL2`, `PrimitiveTypeCardanoDelayedAsset`, … |
| `@effectstream/node-sdk/runtime` | — | `init`, `start`, `StartConfigApiRouter`, `DBMigrations` |
| `@effectstream/node-sdk/coroutine` | — | `World.resolve` |
| `@effectstream/node-sdk/concise` | — | grammars, `generateRawStmInput` |
| `@effectstream/node-sdk/db` | `@effectstream/db` | `getConnection`; `…/../db/scripts/start-pglite.ts` for local dev |
| `@effectstream/event-client` (separate) | `event-server` | `registerEvents`, `genEvent` (MQTT events) and `EventManager` for subscribers |

Other relevant published packages: `@effectstream/batcher-sdk`, `@effectstream/frontend-sdk`, `@effectstream/orchestrator`,
`@effectstream/db-emulator`. Pin `effection@^3.5` (the SDK depends on v3; v4 is incompatible).

**Every package exports only the `"bun"` condition**: the node must run on Bun (Node cannot resolve them). For
`tsc`, add `"customConditions": ["bun"]`.

### The generic EVM primitive

- The SDK contains `EvmGenericPrimitive` (custom ABI), but **`PrimitiveTypeEVMGeneric` is commented out as
  "No tested"** in `packages/node-sdk/sm/primitives/src/builtin.ts` and `mod.ts`, so it cannot be used as a built-in.
- Custom primitives are supported and documented (`userDefinedPrimitives` in `start()`). We register the same logic as
  **`AldeaEvmEventPrimitive`** with type `"EVM:AldeaEvent"` (`src/primitives/evmEvent.ts`). It also appends
  `txHash`, `logIndex` and `blockNumber` (from `syncProtocol`) to every payload, which the read model needs for
  idempotency by `(txHash, logIndex)`.
- Config shape (the object is passed as-is to the primitive's constructor):

  ```ts
  {
    name: "CharacterBirthRequested",
    type: PrimitiveTypeAldeaEvmEvent,            // "EVM:AldeaEvent"
    startBlockHeight: env.startBlock,
    contractAddress: systems.CharacterSystem,     // the SYSTEM address, not the World
    abi: getEvmEvent(characterSystemAbi, "CharacterBirthRequested(uint32,address,bytes32,uint8,uint64)"),
    grammar: birthRequestedGrammar,               // [name, TypeBox schema][] in payload order
    stateMachinePrefix: "birthRequested",
  }
  ```

- **MUD detail:** systems in a non-root namespace emit their events from **their own address**, not the World's.
  `packages/shared/scripts/merge-world.ts` reads the addresses from the World's `world:Systems` table and writes them
  to `packages/shared/src/deployments/<chainId>.json`; the node reads them from there (or `SYSTEM_ADDRESSES_JSON`).

### Other findings

1. **Immutable config.** On the first run Effectstream stores the NTP `startTime` and each chain's
   `startBlockHeight` in `effectstream.sync_protocol_config_snapshot`, and aborts startup if they ever change.
   `src/config.ts` reuses the saved `startTime` and only uses `EFFECTSTREAM_GENESIS_MS` / `Date.now()` on a fresh
   database. Locally, anvil restarts from block 0, so the local Postgres is in memory (`tmpfs`) and every
   `pnpm dev` starts clean.
6. **pg_ivm.** The engine requires the `pg_ivm` extension (PGlite bundles it) and aborts without it unless
   `ALLOW_NO_PG_IVM=true` (plain views, slower). The official `postgres:16` image lacks it, so local `pnpm dev` opts
   in; **production Postgres (Neon or Fly) must provide pg_ivm** — check before choosing the provider.
7. **Silent startup failures.** Both aborts above leave the process alive without logging the cause (the runtime
   keeps the error internally; a `try/catch` around `start()` does not see it). `src/index.ts` has a startup
   watchdog: if `/health` is not up within `STARTUP_TIMEOUT_MS` (60 s) it prints what to check and exits 1.
2. **An SQL error inside an STF kills the node silently.** The runtime catches STF exceptions but does not roll back to
   a savepoint, so the block transaction stays aborted (`25P02 current transaction is aborted`) and the node stops
   processing without logging the cause. We hit it with a malformed query. **Rule for every STF: never issue SQL that
   can fail on chain data** (use `ON CONFLICT`, validate before writing). `src/index.ts` logs unhandled rejections so
   the cause is visible. Worth reporting upstream.
3. **Database.** Effectstream reads `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PW`, `DB_NAME` (not `DATABASE_URL`) and
   keeps its internal tables in a schema literally named `effectstream`; our read model lives in `public` of the
   node's own database. So in the shared Postgres instance the node gets **its own database** (`effectstream`), not a
   schema. Locally, `PGLITE=true` plus the PGlite server works without Docker.
4. **Default endpoints** confirmed on port 9999: `/health` (`{"status":"ok",…}` with apply lag), `/block-heights`,
   plus our `apiRouter` routes.
5. **SQL in STFs.** `World.resolve` takes a pgtyped `PreparedQuery`. `src/sql.ts` builds its IR from SQL with `:param`
   placeholders so we do not need pgtyped codegen against a live database (pgtyped locations are inclusive; covered by
   `test/sql.test.ts`).

## Findings: MQTT, batcher and dynamic primitives

### MQTT from the STF: **native, no gateway needed**

- With `MQTT_BROKER=true` (default) the node embeds an MQTT broker: TCP `8883` (`MQTT_ENGINE_BROKER_PORT`) and
  WebSocket `9883` (`MQTT_ENGINE_BROKER_WS_PORT`) for browsers.
- STFs publish with `data.emit(event, payload)`. Events are declared with `registerEvents`/`genEvent` from
  `@effectstream/event-client` (`src/events.ts`). Delivery is **after the block COMMIT** (a subscriber that calls the
  REST API sees the rows) and events from failed inputs are dropped.
- Verified: a plain `mqtt.js` client subscribed to `app/#` (`scripts/mqtt-probe.ts`) received

  ```
  app/8370528ed838aec6a12d3c61f5050fde6dbfce890f5e452c172950646ad82678/blockHeight/18/characterId/3
  {"status":"gestating","tribe":null,"bornTx":null}
  ```

- **Topic format is fixed by Effectstream:** `app/<eventSignatureHash>/blockHeight/<n>/<indexedField>/<value>…`. The
  originally planned literal topics (`aldea/v1/births/{characterId}`) cannot be used as-is; they become events with indexed fields
  (`BirthUpdated` filtered by `characterId`). Clients subscribe through `EventManager.Instance.subscribe({ topic,
  filter })`. Messages are not retained: widgets read the current value from REST on connect and then follow MQTT.
- The `aedes` + `mqtt.js` gateway from § 4.6 is **not needed**.

### Batcher with CIP-8 signatures: **supported (confirmed in source, not run end to end)**

- The batcher's default verification uses `CryptoManager.getCryptoManager(addressType)`; for `AddressType.CARDANO` it
  verifies CIP-8/CIP-30 `signData` with `@cardano-foundation/cardano-verify-datasignature`.
- The signature is sent as `"<COSE_Sign1 hex>+<COSE_Key hex>"` and the signed message is
  `(namespace + target + timestampMs + address + input)` with every non-alphanumeric character replaced by `-` and
  lowercased (`createMessageForBatcher` in `@effectstream/concise`).
- Inputs go to `POST /send-input` (port 3334) and the `EffectstreamL2DefaultAdapter` posts them to the
  `EffectstreamL2Contract`, which the `PrimitiveTypeEVMEffectstreamL2` primitive reads back.
- Running it end to end needs the EffectstreamL2 contract deployed and a CIP-30 wallet; it is exercised with the
  Council in Phase 5 (Should).

### Dynamic primitives: **not available**

Only a naming helper exists (`generateDynamicPrimitiveName`); there is no API to add primitives at runtime. Impact:

- The Atlas itself is one contract, so a static primitive on `AtlasRegistry` captures every world, version and client.
- Activity of worlds registered later (other Worlds) is not measurable on-chain without a config change, so the Portal
  shows "no medible" (EN: "not measurable") for them, as § Open Questions 5 already planned.

## How to reproduce

```bash
anvil --block-time 2
# deploy protocol + World and export addresses (scripts/dev-deploy.sh wraps this)
bun node_modules/@effectstream/node-sdk/../db/scripts/start-pglite.ts --port 5433   # or a real Postgres
cd packages/effectstream-node && CHAIN_ID=31337 START_BLOCK=<world block> DB_PORT=5433 bun src/index.ts
bun scripts/mqtt-probe.ts                                                           # in another terminal
cast send $WORLD 'aldea__requestBirth(uint8,bytes32)' 0 $SOUL_HASH --private-key …
curl localhost:9999/api/v1/births/1
```
