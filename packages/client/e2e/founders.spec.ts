import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { worldAbi } from "@aldea/shared/abis";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { cardanoConfigured, installWallet, newHolder } from "./cardano";

/**
 * Founders: linking a Cardano wallet with a signature, claiming the seal, and being born during Genesis. The wallet in
 * the browser is a test one that signs for real; what it holds is set in the read model by the test. Needs the local
 * stack with Cardano (`CARDANO_UTXORPC_URL=http://localhost:50051 pnpm dev`); without it these tests are skipped.
 */

// anvil's default account 0: a public development key that owns the local deployment
const OWNER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const deployment = JSON.parse(readFileSync(new URL("../../shared/src/deployments/31337.json", import.meta.url), "utf8")) as {
  world: { address: Address };
  protocol: { almaAnchorRegistry: Address };
};
const owner = createWalletClient({ account: OWNER, chain: foundry, transport: http() });
const chain = createPublicClient({ chain: foundry, transport: http() });
/** Genesis until `genesisEndsAt` (unix seconds; 0 turns it off), leaving the rest of the config as the local deploy set it. */
const setGenesis = async (genesisEndsAt: number) =>
  chain.waitForTransactionReceipt({
    hash: await owner.writeContract({
      address: deployment.world.address,
      abi: worldAbi,
      functionName: "aldea__setConfig",
      args: [deployment.protocol.almaAnchorRegistry, OWNER.address, 1_000_000_000n, BigInt(genesisEndsAt), 3],
    }),
    pollingInterval: 100,
  });

test.beforeEach(async () => {
  test.skip(!(await cardanoConfigured()), "the local Effectstream is not following Cardano");
});
test.afterAll(async () => {
  await setGenesis(0);
});

async function signIn(context: BrowserContext, page: Page, hash: string) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto(`/${hash}`);
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/ }).click();
  await page.getByRole("button", { name: /Crear mi alma|Create my soul/ }).click();
  await expect(page).toHaveURL(new RegExp(`${hash.replace(/[/#]/g, "\\$&")}$`));
}

const LINK = /^(Vincular Cardano|Link Cardano)$/;
const dialog = (page: Page) => page.getByRole("dialog", { name: LINK });
const seals = (page: Page) => page.getByRole("region", { name: /^(Sellos|Seals)$/ });

test("without a Cardano wallet in the browser, the dialog says which ones to install", async ({ context, page }) => {
  await signIn(context, page, "#/b/registro-de-almas");
  await seals(page).getByRole("button", { name: LINK }).click();
  await expect(dialog(page).getByRole("status")).toHaveText(/No encontramos wallets de Cardano|We couldn't find any Cardano wallets/);
});

test("links a wallet with a signature, shows the exact message, and says what is missing for the seal", async ({ context, page }) => {
  const holder = await newHolder(500);
  await installWallet(page, holder, { declines: 1 });
  await signIn(context, page, "#/b/registro-de-almas");
  await seals(page).getByRole("button", { name: LINK }).click();
  await dialog(page).getByRole("button", { name: "Test wallet" }).click();

  // The message is shown as it will be signed, and it names this soul
  const payload = dialog(page).getByTestId("cardano-payload");
  await expect(payload).toContainText(/ALDEA World · vincular Cardano\nalma: alma:main:human:[0-9a-f]{32}\ndominio: localhost:3100/);
  await expect(dialog(page).getByText(/no se arma ninguna transacción|no transaction is built/)).toBeVisible();

  // Declined in the wallet: back to the message, with no technical error
  await dialog(page).getByRole("button", { name: /^(Firmar|Sign)$/ }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText(/No firmaste el mensaje|You didn't sign the message/);
  await dialog(page).getByRole("button", { name: /^(Firmar|Sign)$/ }).click();

  await expect(dialog(page).getByTestId("cardano-holdings")).toHaveText(/(Tiene|It holds) 500 \$ALDEA\. (Te faltan|You need) 500 (\$ALDEA para el sello|more \$ALDEA for the seal)\./);
  await expect(dialog(page).getByText(`cardano:${holder.credential}`.slice(0, 20))).toBeVisible();
  // Not eligible: no way to claim from here
  await expect(dialog(page).getByRole("button", { name: /Reclamar sello|Claim seal/ })).toHaveCount(0);
  await dialog(page).getByRole("button", { name: /^(Cerrar|Close)$/ }).last().click();

  // Claiming anyway is refused by the Resolver, with the same amount
  await seals(page).getByRole("button", { name: /Reclamar sello|Claim seal/ }).click();
  await expect(seals(page).getByRole("alert")).toHaveText(/(Te faltan|You need) 500 /);
  await expect(seals(page).getByTestId("founder-badge")).toHaveCount(0);
});

test("a holder claims the Founder seal, and anyone sees it on their soul", async ({ browser, context, page }) => {
  const holder = await newHolder(5000);
  await installWallet(page, holder);
  await signIn(context, page, "#/b/registro-de-almas");
  await seals(page).getByRole("button", { name: LINK }).click();
  await dialog(page).getByRole("button", { name: "Test wallet" }).click();
  await dialog(page).getByRole("button", { name: /^(Firmar|Sign)$/ }).click();
  await expect(dialog(page).getByTestId("cardano-holdings")).toHaveText(/(Tiene|It holds) 5[.,]000 \$ALDEA\.$/);

  // From the dialog: the soul is anchored and the seal claimed in one operation
  await dialog(page).getByRole("button", { name: /Reclamar sello|Claim seal/ }).click();
  await expect(seals(page).getByTestId("founder-badge")).toBeVisible({ timeout: 60_000 });
  await expect(seals(page).getByRole("button", { name: /Reclamar sello|Claim seal/ })).toHaveCount(0);
  // And next to the soul in the header, wherever the player goes
  await expect(page.getByTestId("hud-founder")).toBeVisible();

  // The read model has it, with the credential that claimed
  const almaId = await page.getByRole("region", { name: /^(Tu alma|Your soul)$/ }).getByTitle(/^alma:main:human:/).getAttribute("title");
  const { almaIdHash } = await import("@aldea/shared/alma");
  await expect
    .poll(async () => ((await (await fetch(`http://localhost:9999/api/v1/founders/${almaIdHash(almaId!)}`)).json()) as { stakeCredential?: string }).stakeCredential, { timeout: 30_000 })
    .toBe(holder.credential.split(":")[1]);

  // A guest looking at that soul sees the seal too
  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  await visitor.goto(`/#/alma/${almaId}`);
  await expect(visitor.getByRole("region", { name: /^(Sellos|Seals)$/ }).getByTestId("founder-badge")).toBeVisible({ timeout: 30_000 });
  await guest.close();
});

test("during Genesis only holders are born, and they are born with the seal in one step", async ({ context, page }) => {
  await setGenesis(Math.floor(Date.now() / 1000) + 3600);
  const holder = await newHolder(1000);
  await installWallet(page, holder);
  await signIn(context, page, "#/b/centro-urbano");

  // Founders first: the notice explains it, and no class can be chosen yet
  const notice = page.getByTestId("genesis-notice");
  await expect(notice.getByRole("heading", { name: /Fundadores primero|Founders first/ })).toBeVisible({ timeout: 15_000 });
  await expect(notice.getByText(/La aldea se abre para todas las almas el|The village opens to every soul on/)).toBeVisible();
  const beBorn = page.getByRole("button", { name: /^(Nacer como|Be born as) / });
  await page.getByRole("radio").first().click();
  await expect(beBorn).toBeDisabled();

  // Link the wallet (exactly the minimum), then be born: anchor, seal and birth in one operation
  await notice.getByRole("button", { name: LINK }).click();
  await dialog(page).getByRole("button", { name: "Test wallet" }).click();
  await dialog(page).getByRole("button", { name: /^(Firmar|Sign)$/ }).click();
  await expect(dialog(page).getByTestId("cardano-holdings")).toBeVisible();
  await dialog(page).getByRole("button", { name: /^(Cerrar|Close)$/ }).last().click();
  await expect(notice.getByRole("status")).toHaveText(/Tu wallet está vinculada|Your wallet is linked/);
  await beBorn.click();
  await expect(page.getByText(/Tu alma está llegando|Your soul is arriving/)).toBeVisible({ timeout: 30_000 });

  await page.goto("/#/b/registro-de-almas");
  await expect(seals(page).getByTestId("founder-badge")).toBeVisible({ timeout: 60_000 });
});
