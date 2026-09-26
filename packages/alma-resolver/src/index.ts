import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { createPublicClient, http } from "viem";
import { createApp } from "./app";
import { createDb } from "./db/client";
import { logger } from "./lib/logger";
import { initSentry } from "./lib/sentry";

initSentry();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const { db } = createDb(databaseUrl);
const base = createPublicClient({ transport: http(process.env.BASE_RPC_URL ?? "http://127.0.0.1:8545") });

const app = createApp({
  pingDb: async () => {
    await db.execute(sql`select 1`);
  },
  baseHead: () => base.getBlockNumber(),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((o) => o.trim()),
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => logger.info({ port }, "alma-resolver listening"));
