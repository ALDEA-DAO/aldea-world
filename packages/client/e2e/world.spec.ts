import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { worldAbi } from "@aldea/shared/abis";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

/**
 * The World in the client: the census shows up for guests, and an on-chain change (pausing the World, as its local
 * owner) is on screen less than 3 seconds after its block. Needs anvil with the World deployed (`pnpm dev`).
 */

// anvil's default account 0: a public development key that owns the local deployment
const OWNER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const deployment = JSON.parse(readFileSync(new URL("../../shared/src/deployments/31337.json", import.meta.url), "utf8")) as { world: { address: Address } };
const owner = createWalletClient({ account: OWNER, chain: foundry, transport: http() });
const chain = createPublicClient({ chain: foundry, transport: http() });
const setPaused = (paused: boolean) => owner.writeContract({ address: deployment.world.address, abi: worldAbi, functionName: "aldea__setPaused", args: [paused] });

test.afterAll(async () => {
  await setPaused(false);
});

test("guests see the live census and a pause within 3 seconds", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByTestId("mini-census")).toContainText(/\d+ (almas nacidas|souls born)/);

  const banner = page.getByTestId("paused-banner");
  await expect(banner).toBeHidden();
  // From the block that pauses it: sending the transaction and waiting for anvil's next 2 s block is not the client's time
  await chain.waitForTransactionReceipt({ hash: await setPaused(true), pollingInterval: 100 });
  const started = Date.now();
  await expect(banner).toBeVisible({ timeout: 3_000 });
  expect(Date.now() - started).toBeLessThan(3_000);

  // Paused: you can look, but "Entrar" is disabled everywhere (List mode shows all six)
  await page.goto("/#/lista");
  await expect(page.getByRole("navigation", { name: /Edificios de la aldea|Village buildings/ }).getByRole("button", { disabled: true })).toHaveCount(6);
  await expect(banner).toHaveText(/La aldea está en mantenimiento\. Puedes mirar, pero no nacer ni entrar por ahora\.|The village is under maintenance\. You can look around, but you can't be born or enter buildings for now\./);

  await chain.waitForTransactionReceipt({ hash: await setPaused(false), pollingInterval: 100 });
  await expect(banner).toBeHidden({ timeout: 3_000 });
});

test("offline: a banner says so and entering is disabled until the connection is back", async ({ context, page }) => {
  await page.goto("/#/lista");
  const nav = page.getByRole("navigation", { name: /Edificios de la aldea|Village buildings/ });
  await expect(nav.getByRole("link", { name: /Entrar al Centro Urbano|Enter the Town Center/ })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/Estás sin conexión\. La aldea te espera|You're offline\. The village is waiting for you/)).toBeVisible();
  await expect(nav.getByRole("button", { name: /Entrar al Centro Urbano|Enter the Town Center/ })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByText(/Estás sin conexión\. La aldea te espera|You're offline\. The village is waiting for you/)).toBeHidden();
  await expect(nav.getByRole("link", { name: /Entrar al Centro Urbano|Enter the Town Center/ })).toBeVisible();
});
