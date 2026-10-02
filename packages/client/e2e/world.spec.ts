import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { worldAbi } from "@aldea/shared/abis";
import { createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

/**
 * The World in the client: the census shows up for guests, and an on-chain change (pausing the World, as its local
 * owner) is on screen in under 3 seconds. Needs anvil with the World deployed (`pnpm dev`).
 */

// anvil's default account 0: a public development key that owns the local deployment
const OWNER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const deployment = JSON.parse(readFileSync(new URL("../../shared/src/deployments/31337.json", import.meta.url), "utf8")) as { world: { address: Address } };
const owner = createWalletClient({ account: OWNER, chain: foundry, transport: http() });
const setPaused = (paused: boolean) => owner.writeContract({ address: deployment.world.address, abi: worldAbi, functionName: "aldea__setPaused", args: [paused] });

test.afterAll(async () => {
  await setPaused(false);
});

test("guests see the live census and a pause within 3 seconds", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByTestId("mini-census")).toContainText(/\d+ (almas nacidas|souls born)/);

  const banner = page.getByText(/La aldea está en pausa|The village is paused/);
  await expect(banner).toBeHidden();
  const started = Date.now();
  await setPaused(true);
  await expect(banner).toBeVisible({ timeout: 3_000 });
  expect(Date.now() - started).toBeLessThan(3_000);

  await setPaused(false);
  await expect(banner).toBeHidden({ timeout: 3_000 });
});
