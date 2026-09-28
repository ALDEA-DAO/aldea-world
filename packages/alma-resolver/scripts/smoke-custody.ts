/**
 * End-to-end check of the custody stack on Base Sepolia (TASK-017), without ALMA Auth:
 *   1. the parent org creates a soul's sub-organization with its OIDC identity as claims and an EVM account;
 *   2. that account owns a Coinbase Smart Wallet;
 *   3. the CDP bundler and paymaster sponsor a UserOperation from it;
 *   4. the test sub-organization is deleted.
 * Real souls have no API key; this script adds a throwaway one to the root user so it can sign without an ID token.
 *
 *   pnpm --filter @aldea/alma-resolver smoke:custody          # reads .env.staging
 *   SMOKE_TARGET=0x… pnpm --filter @aldea/alma-resolver smoke:custody   # call a contract instead of the account itself
 *   SMOKE_VIA_PROXY=1 pnpm --filter @aldea/alma-resolver smoke:custody  # go through the Resolver's /v1/aa/rpc proxy
 *
 * Through the proxy, the sponsorship policy is replaced by one that accepts everything: the World is not on Base
 * Sepolia yet, so this checks that the proxy forwards every method viem's bundler client needs.
 */
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Turnkey } from "@turnkey/sdk-server";
import { generateP256KeyPair } from "@turnkey/crypto";
import { createAccount } from "@turnkey/viem";
import { createPublicClient, http, isAddress, type Hex } from "viem";
import { createBundlerClient, toCoinbaseSmartAccount } from "viem/account-abstraction";
import { baseSepolia } from "viem/chains";
import { createApp } from "../src/app";
import { createSoulCustody, createTurnkeyClient, soulSubOrganizationParams, turnkeyConfigFromEnv } from "../src/lib/turnkey";

const config = turnkeyConfigFromEnv();
const bundlerUrl = process.env.CDP_PAYMASTER_URL;
if (!config || !bundlerUrl) throw new Error("TURNKEY_ORG_ID, TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY and CDP_PAYMASTER_URL are required");
// The CDP endpoint embeds its API key: never print it.
const redact = (text: string) => text.split(bundlerUrl).join("<CDP_PAYMASTER_URL>");
const step = (msg: string) => console.log(`▸ ${msg}`);

const almaId = `alma:main:human:${randomBytes(16).toString("hex")}`;
const params = soulSubOrganizationParams({ almaId, issuer: "https://auth.adasouls.io", audience: "aldea-world" });
const smokeKey = generateP256KeyPair();
params.rootUsers[0]!.apiKeys.push({ apiKeyName: "smoke", publicKey: smokeKey.publicKey, curveType: "API_KEY_CURVE_P256" });
params.subOrganizationName = `smoke ${almaId}`;

let subOrg: Turnkey | undefined;
let proxy: ReturnType<typeof serve> | undefined;
let subOrganizationId: string | undefined;
try {
  step(`sub-organization for ${almaId}`);
  const custody = await createSoulCustody(createTurnkeyClient(config), params);
  subOrganizationId = custody.subOrganizationId;
  console.log(`  ${custody.subOrganizationId} · owner ${custody.ownerAddress}`);

  subOrg = new Turnkey({ ...config, defaultOrganizationId: custody.subOrganizationId, apiPublicKey: smokeKey.publicKey, apiPrivateKey: smokeKey.privateKey });
  const owner = await createAccount({ client: subOrg.apiClient(), organizationId: custody.subOrganizationId, signWith: custody.ownerAddress, ethereumAddress: custody.ownerAddress });

  const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org") });
  const account = await toCoinbaseSmartAccount({ client, owners: [owner], version: "1.1" });
  step(`Coinbase Smart Wallet ${account.address} (counterfactual)`);

  let rpcUrl = bundlerUrl;
  if (process.env.SMOKE_VIA_PROXY) {
    const app = createApp({
      pingDb: async () => {},
      baseHead: async () => 0n,
      corsOrigins: [],
      aa: { bundlerUrl, chainId: baseSepolia.id, checkSponsorship: () => ({ ok: true }), authenticate: async () => almaId },
    });
    proxy = serve({ fetch: app.fetch, port: 0 });
    await new Promise((resolve) => proxy!.once("listening", resolve));
    rpcUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/v1/aa/rpc`;
    step(`through the proxy at ${rpcUrl}`);
  }
  const bundler = createBundlerClient({ account, client, transport: http(rpcUrl), paymaster: true });
  const target = process.env.SMOKE_TARGET;
  const to = target && isAddress(target) ? target : account.address;
  step(`sponsored UserOperation → ${to}`);
  const hash = await bundler.sendUserOperation({ calls: [{ to, value: 0n, data: "0x" as Hex }] });
  const receipt = await bundler.waitForUserOperationReceipt({ hash, timeout: 120_000 });
  console.log(`  ${receipt.success ? "✓" : "✗"} https://sepolia.basescan.org/tx/${receipt.receipt.transactionHash}`);
  console.log(`  paymaster ${receipt.paymaster ?? "none"} · gas ${receipt.actualGasUsed}`);
  if (!receipt.success) process.exitCode = 1;
} catch (err) {
  console.error(`✗ ${redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err))}`);
  process.exitCode = 1;
} finally {
  proxy?.close();
  if (subOrg && subOrganizationId) {
    step(`delete ${subOrganizationId}`);
    await subOrg
      .apiClient()
      .deleteSubOrganization({ deleteWithoutExport: true })
      .catch((err: unknown) => console.error(`  could not delete: ${err instanceof Error ? err.message : err}`));
  }
}
