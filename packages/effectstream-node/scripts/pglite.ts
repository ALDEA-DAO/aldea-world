/**
 * Embedded Postgres-compatible server for local development without Docker (PGlite, in memory by default).
 *   bun scripts/pglite.ts --port 5443      (PGLITE_DATA_DIR=./pgdata for persistence)
 * Used by mprocs.lite.yaml for the Effectstream, Resolver and MUD indexer databases.
 */
import { startPglite } from "@effectstream/node-sdk/db/start-pglite";

const i = process.argv.indexOf("--port");
const port = i === -1 ? 5443 : Number(process.argv[i + 1]);
await startPglite(port);
