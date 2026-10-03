import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { buildingId } from "@aldea/shared/catalog";
import { createPublicClient, http, parseAbiItem } from "viem";
import { foundry } from "viem/chains";

/**
 * List mode: the same buildings and actions without the canvas. Born and into a building with the keyboard only
 * (Tab, arrows, Enter; the passkey ceremony is the browser's own dialog), and the automatic switch when the device
 * has no WebGL. Needs the local stack (`pnpm dev`).
 */

async function passkeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

/** Presses Tab until `target` has the focus (what a keyboard user does), failing after `max` presses. */
async function tabTo(page: Page, target: ReturnType<Page["getByRole"]>, max = 60) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

test("without WebGL the client switches to List mode and says why", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return /webgl/.test(type) ? null : (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto("/#/b/registro-de-almas");
  await expect(page).toHaveURL(/#\/lista\/registro-de-almas$/);
  await expect(page.getByRole("status").filter({ hasText: /no puede dibujar la aldea|cannot draw the village/ })).toBeVisible();
  await expect(page.getByTestId("list-building").getByRole("heading", { name: /Registro de Almas|Soul Registry/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: /Edificios de la aldea|Village buildings/ }).getByRole("listitem")).toHaveCount(6);
});

test("born and into a building with the keyboard only", async ({ context, page }) => {
  test.setTimeout(120_000);
  await passkeyDevice(context, page);
  await page.goto("/#/lista");
  const nav = page.getByRole("navigation", { name: /Edificios de la aldea|Village buildings/ });
  await expect(nav.getByRole("listitem")).toHaveCount(6);

  // Sign in from the status header, with the keyboard
  await tabTo(page, page.getByRole("button", { name: /Inicia sesión para nacer|Sign in to be born/ }));
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: /Crear mi alma|Create my soul/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/lista$/);
  await expect(page.getByTestId("list-status")).toContainText(/Tu alma|Your soul/);

  // Into the Town Center: the focus lands on its heading
  await tabTo(page, nav.getByRole("link", { name: /Entrar al Centro Urbano|Enter the Town Center/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/lista\/centro-urbano$/);
  await expect(page.getByRole("heading", { level: 2, name: /^(Centro Urbano|Town Center)$/ })).toBeFocused();

  // Choose a class with the arrows and be born
  await tabTo(page, page.getByRole("radio").first());
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio").nth(1)).toHaveAttribute("aria-checked", "true");
  await tabTo(page, page.getByRole("button", { name: /^(Nacer como|Be born as) / }));
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Tu alma ya tiene nombre|Your soul now has a name/)).toBeVisible({ timeout: 45_000 });
  await tabTo(page, page.getByRole("button", { name: /Recorrer la aldea|Explore the village/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/lista$/);
  await expect(page.getByTestId("list-status").getByText(/Amazónicos|Himalayos|Poseidones|Raes|Tropicales|Amazonians|Himalayans|Poseidons|Tropicals/)).toBeVisible();

  // Into the Portal, recorded on-chain like in the village
  const chain = createPublicClient({ chain: foundry, transport: http() });
  const fromBlock = await chain.getBlockNumber();
  await tabTo(page, nav.getByRole("link", { name: /Entrar al Portal de los Mundos|Enter the Portal of Worlds/ }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: /Portal de los Mundos|Portal of Worlds/ })).toBeFocused();
  const entered = parseAbiItem("event BuildingEntered(uint32 indexed characterId, bytes32 indexed buildingId, bytes32 indexed almaIdHash)");
  await expect
    .poll(async () => (await chain.getLogs({ event: entered, args: { buildingId: buildingId("portal") }, fromBlock })).length, { timeout: 10_000 })
    .toBe(1);
});
