import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "./app";
import { bearerToken, createAccessTokenVerifier } from "./auth/accessToken";
import { createChallengeStore } from "./auth/interaction";
import { loadSigningKeys, publicJwks } from "./auth/keys";
import { canAddOwner } from "./auth/links";
import { logSender, resendSender } from "./auth/methods/email";
import { createAlmaAuth } from "./auth/provider";
import { createDb } from "./db/client";
import { logger } from "./lib/logger";
import { initSentry } from "./lib/sentry";
import { createSponsorshipPolicy } from "./lib/sponsorship";
import { createSyncJob, effectstreamFeeds } from "./jobs/syncFromEffectstream";
import { soulActivityFromDb } from "./routes/orgs";
import { createAttestor } from "./lib/attestor";
import type { Holdings } from "./routes/founders";
import { createPresenceStore } from "./routes/presence";
import { loadDeployment } from "./seed/orgs";
import { createTurnkeyClient, turnkeyConfigFromEnv, turnkeyCustodyProvisioner } from "./lib/turnkey";
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
const chainId = Number(env.BASE_CHAIN_ID ?? 31337);
const issuerUrl = new URL(issuer);

// Custody: every new soul gets a Turnkey sub-organization and a Coinbase Smart Wallet (not locally: anvil has neither
// Turnkey's reach to a localhost issuer nor the smart-wallet factory).
const turnkeyConfig = turnkeyConfigFromEnv();
const turnkey = turnkeyConfig ? createTurnkeyClient(turnkeyConfig) : undefined;
const soul = {
  db,
  chainId,
  provisionCustody: turnkey
    ? turnkeyCustodyProvisioner({
        turnkey,
        base,
        issuer,
        // Turnkey logs the soul in with ID tokens issued to this world's OIDC client
        audience: env.TURNKEY_OIDC_AUDIENCE ?? "aldea-world",
      })
    : undefined,
};

const corsOrigins = (env.CORS_ORIGINS ?? "http://localhost:3100").split(",").map((o) => o.trim());
const challenges = createChallengeStore(db);

// Login methods on the hosted pages
const resendKey = env.RESEND_API_KEY;
if (!resendKey && production) throw new Error("RESEND_API_KEY is required in production");
const interaction = {
  auth,
  soul,
  passkey: { rpID: env.WEBAUTHN_RP_ID ?? issuerUrl.hostname, origin: issuerUrl.origin },
  wallet: { domain: issuerUrl.host, origin: issuerUrl.origin, chainId, client: base },
  email: {
    hmacKey: secret("EMAIL_HMAC_KEY"),
    sender: resendKey ? resendSender({ apiKey: resendKey, from: env.RESEND_FROM ?? "ALMA <login@adasouls.io>" }) : logSender,
  },
};

// Sponsored gas needs the CDP endpoint and the addresses of the contracts it may pay for.
const { CDP_PAYMASTER_URL, WORLD_ADDRESS, ALMA_REGISTRY_ADDRESS } = env;
const aa =
  CDP_PAYMASTER_URL && WORLD_ADDRESS && ALMA_REGISTRY_ADDRESS
    ? {
        bundlerUrl: CDP_PAYMASTER_URL,
        chainId,
        checkSponsorship: createSponsorshipPolicy({ world: getAddress(WORLD_ADDRESS), almaRegistry: getAddress(ALMA_REGISTRY_ADDRESS) }),
        authenticate: async (c: Context) => {
          const token = bearerToken(c);
          return token ? (await verifyAccessToken(token))?.almaId : undefined;
        },
        approveOwnerAddition: (almaId: string, sender: string, owner: string) => canAddOwner(db, chainId, almaId, sender, owner),
      }
    : undefined;

const effectstreamUrl = env.EFFECTSTREAM_API_URL ?? "http://localhost:9999";

/** $ALDEA holdings of a Cardano credential, from Effectstream. */
const holdings = async (credential: string): Promise<Holdings | undefined> => {
  const res = await fetch(`${effectstreamUrl}/api/v1/cardano/holdings/${credential}`, { signal: AbortSignal.timeout(5_000) });
  return res.ok ? ((await res.json()) as Holdings) : undefined;
};

// The key that signs Founder attestations. Locally it is anvil's account 0, which the local deploy sets as the
// World's attestor; any real network has to provide its own.
const attestorKey = env.FOUNDER_ATTESTOR_PRIVATE_KEY || (production ? undefined : "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
if (!attestorKey) throw new Error("FOUNDER_ATTESTOR_PRIVATE_KEY is required in production");
const attestor = createAttestor(privateKeyToAccount(attestorKey as Hex));

const app = createApp({
  pingDb: async () => {
    await db.execute(sql`select 1`);
  },
  baseHead: () => base.getBlockNumber(),
  corsOrigins,
  aa,
  interaction,
  souls: {
    soul,
    verifyAccessToken,
    // Characters and tribes as the sync job recorded them from Effectstream
    activity: soulActivityFromDb(db),
    allowDevelopmentController: !turnkey && !production,
  },
  links: {
    me: { db, challenges, verifyAccessToken, wallet: interaction.wallet, email: interaction.email, worldOrigins: corsOrigins, issuer },
    passkey: { db, challenges, passkey: interaction.passkey },
  },
  custody: turnkey ? { soul, turnkey, verifyAccessToken, issuer, jwks: publicJwks(signingKeys) } : undefined,
  cardano: {
    db,
    challenges,
    verifyAccessToken,
    // Mainnet only next to Base mainnet; every other chain goes with a Cardano test network
    network: (env.CARDANO_NETWORK ?? (chainId === 8453 ? "mainnet" : "preprod")) === "mainnet" ? 1 : 0,
    worldOrigins: corsOrigins,
    holdings,
  },
  founders: {
    db,
    verifyAccessToken,
    attestor,
    chainId,
    world: () => (env.WORLD_ADDRESS as Address | undefined) || loadDeployment(chainId)?.world?.address,
    holdings,
    isFounder: async (almaIdHash) => (await fetch(`${effectstreamUrl}/api/v1/founders/${almaIdHash}`, { signal: AbortSignal.timeout(5_000) })).ok,
  },
  presence: { verifyAccessToken, store: createPresenceStore(), aldeaWorldId: () => env.ALDEA_WORLD_ID || loadDeployment(chainId)?.aldeaWorldId },
});

// Every 2 s: anchors and births from Effectstream into souls, bindings and tribe memberships
const sync = createSyncJob({ db, feeds: effectstreamFeeds(effectstreamUrl), deployment: () => loadDeployment(chainId) });
let syncDown = false;
setInterval(() => {
  sync.tick().then(
    () => (syncDown = false),
    (err: unknown) => {
      // Effectstream may be starting or restarting: say so once, then stay quiet until it is back
      if (!syncDown) logger.warn({ err: err instanceof Error ? err.message : String(err) }, "sync from Effectstream is failing");
      syncDown = true;
    },
  );
}, Number(env.SYNC_INTERVAL_MS ?? 2_000)).unref();

createResolverServer(app, auth).listen(port, () => logger.info({ port, issuer }, "alma-resolver listening"));
