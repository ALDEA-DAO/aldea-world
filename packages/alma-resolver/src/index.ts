import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { createPublicClient, getAddress, http } from "viem";
import { createApp } from "./app";
import { createDb } from "./db/client";
import { logger } from "./lib/logger";
import { initSentry } from "./lib/sentry";
import { createSponsorshipPolicy } from "./lib/sponsorship";

initSentry();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const { db } = createDb(databaseUrl);
const base = createPublicClient({ transport: http(process.env.BASE_RPC_URL ?? "http://127.0.0.1:8545") });

// Sponsored gas needs the CDP endpoint and the addresses of the contracts it may pay for.
const { CDP_PAYMASTER_URL, WORLD_ADDRESS, ALMA_REGISTRY_ADDRESS } = process.env;
const aa =
  CDP_PAYMASTER_URL && WORLD_ADDRESS && ALMA_REGISTRY_ADDRESS
    ? {
        bundlerUrl: CDP_PAYMASTER_URL,
        chainId: Number(process.env.BASE_CHAIN_ID ?? 84532),
        checkSponsorship: createSponsorshipPolicy({ world: getAddress(WORLD_ADDRESS), almaRegistry: getAddress(ALMA_REGISTRY_ADDRESS) }),
        // Closed until ALMA Auth verifies access tokens: no request is authenticated yet.
        authenticate: async () => undefined,
      }
    : undefined;

const app = createApp({
  pingDb: async () => {
    await db.execute(sql`select 1`);
  },
  baseHead: () => base.getBlockNumber(),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((o) => o.trim()),
  aa,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => logger.info({ port }, "alma-resolver listening"));
