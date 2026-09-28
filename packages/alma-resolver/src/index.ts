import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { createPublicClient, getAddress, http } from "viem";
import { createApp } from "./app";
import { bearerToken, createAccessTokenVerifier } from "./auth/accessToken";
import { loadSigningKeys, publicJwks } from "./auth/keys";
import { createAlmaAuth } from "./auth/provider";
import { createDb } from "./db/client";
import { logger } from "./lib/logger";
import { initSentry } from "./lib/sentry";
import { createSponsorshipPolicy } from "./lib/sponsorship";
import { createResolverServer } from "./server";

initSentry();

const env = process.env;
const production = env.NODE_ENV === "production";
/** A secret that production must provide; development falls back to a throwaway value. */
function secret(name: string): string {
  const value = env[name];
  if (value) return value;
  if (production) throw new Error(`${name} is required in production`);
  logger.warn(`${name} is not set: using a throwaway value (development only)`);
  return randomBytes(32).toString("base64url");
}

const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const { db } = createDb(databaseUrl);
const base = createPublicClient({ transport: http(env.BASE_RPC_URL ?? "http://127.0.0.1:8545") });
const port = Number(env.PORT ?? 8787);

// ALMA Auth (Sign in with ALMA)
const issuer = env.ALMA_AUTH_ISSUER ?? `http://localhost:${port}`;
const apiResource = env.ALMA_API_RESOURCE ?? `http://localhost:${port}/v1`;
const signingKeys = await loadSigningKeys();
const auth = createAlmaAuth({
  issuer,
  db,
  signingKeys,
  cookieKeys: secret("ALMA_AUTH_COOKIE_KEYS").split(","),
  pairwiseSalt: secret("ALMA_AUTH_PAIRWISE_SALT"),
  apiResource,
  proxy: production,
});
const verifyAccessToken = createAccessTokenVerifier({ issuer, audience: apiResource, jwks: publicJwks(signingKeys) });

// Sponsored gas needs the CDP endpoint and the addresses of the contracts it may pay for.
const { CDP_PAYMASTER_URL, WORLD_ADDRESS, ALMA_REGISTRY_ADDRESS } = env;
const aa =
  CDP_PAYMASTER_URL && WORLD_ADDRESS && ALMA_REGISTRY_ADDRESS
    ? {
        bundlerUrl: CDP_PAYMASTER_URL,
        chainId: Number(env.BASE_CHAIN_ID ?? 84532),
        checkSponsorship: createSponsorshipPolicy({ world: getAddress(WORLD_ADDRESS), almaRegistry: getAddress(ALMA_REGISTRY_ADDRESS) }),
        authenticate: async (c: Context) => {
          const token = bearerToken(c);
          return token ? (await verifyAccessToken(token))?.almaId : undefined;
        },
      }
    : undefined;

const app = createApp({
  pingDb: async () => {
    await db.execute(sql`select 1`);
  },
  baseHead: () => base.getBlockNumber(),
  corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((o) => o.trim()),
  aa,
});

createResolverServer(app, auth).listen(port, () => logger.info({ port, issuer }, "alma-resolver listening"));
