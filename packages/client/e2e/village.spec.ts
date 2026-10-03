import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { buildingId } from "@aldea/shared/catalog";
import { createPublicClient, http, parseAbiItem } from "viem";
import { foundry } from "viem/chains";

/**
 * The village as a game: guests see the isometric map and reach buildings from it; a born soul has a character that
 * walks with the keyboard and with clicks, and is offered to go into a building when it stands at its door. Going in
 * opens the panel over the village at once and is recorded on-chain; closing it records the exit.
 * Needs the full local stack (`pnpm dev`).
 */

async function passkeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

const village = (page: Page) => page.getByTestId("village");
const tile = async (page: Page) => (await village(page).getAttribute("data-tile")) ?? "";

test("a guest sees the village and goes into a building with the keyboard", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByText(/El camino se está abriendo|The path is opening/)).toBeVisible();
  await expect(village(page)).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect(page.getByTestId("mini-census")).toContainText(/almas nacidas|souls born/);
  // No character yet: the bottom bar invites to be born, and that opens the Town Center over the village
  await page.getByTestId("be-born").click();
  await expect(page.getByRole("region", { name: /Centro Urbano|Town Center/ })).toBeVisible();
  await expect(page.getByRole("radio").first()).toBeVisible();
  await page.screenshot({ path: "test-results/village-town-center.png" });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/$/);

  const canvas = village(page).locator("canvas");
  await expect(canvas).toHaveAttribute("aria-label", /aldea|village/i);
  await canvas.focus();
  await page.keyboard.press("Tab");
  await expect(village(page)).toHaveAttribute("data-door", /.+/);
  await page.keyboard.press("Enter");
  // The first door from the top of the map is the Council's: its panel opens over the village
  await expect(page).toHaveURL(/#\/b\/consejo$/);
  await expect(page.getByRole("region", { name: /^(Consejo|Council)$/ }).getByText(/abrirá con el Acta de Génesis|will open with the Genesis Charter/)).toBeVisible();
});

test("a born soul walks the village and is offered the door it stands at", async ({ context, page }) => {
  test.setTimeout(120_000);
  await passkeyDevice(context, page);
  await page.goto("/#/b/centro-urbano");
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/ }).click();
  await page.getByRole("button", { name: /Entrar con mi passkey|Sign in with my passkey/ }).click();
  await page.getByRole("button", { name: /Crear mi alma|Create my soul/ }).click();
  await page.getByRole("radio").nth(3).click();
  await page.getByRole("button", { name: /^(Nacer como|Be born as) / }).click();
  await expect(page.getByText(/Tu alma ya tiene nombre|Your soul now has a name/)).toBeVisible({ timeout: 45_000 });

  await page.goto("/#/");
  await expect(village(page)).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  // Born in front of the Town Center, whose door is at (20, 20)
  await expect(village(page)).toHaveAttribute("data-tile", "20,21");
  await page.screenshot({ path: "test-results/village.png" });

  // Keyboard: down on screen is +x and +y on the map
  const canvas = village(page).locator("canvas");
  await canvas.focus();
  await page.keyboard.down("ArrowDown");
  await expect.poll(() => tile(page)).not.toBe("20,21");
  await page.keyboard.up("ArrowDown");
  const [x, y] = (await tile(page)).split(",").map(Number);
  expect(x).toBeGreaterThan(20);
  expect(y! - x!).toBe(1);

  // Tab to the third door (the Portal) and Enter: the character walks there and the bottom bar offers the door
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(village(page)).toHaveAttribute("data-door", "portal", { timeout: 20_000 });
  const enter = page.getByTestId("enter-building");
  await expect(enter).toHaveText(/Entrar al Portal de los Mundos|Enter the Portal of Worlds/);
  await page.screenshot({ path: "test-results/village-door.png" });

  // A click on the ground walks away from the door, and the offer goes with it
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 150, box.y + box.height / 2 + 120);
  await expect(enter).toBeHidden({ timeout: 10_000 });

  // Back to the door, then in: the panel opens over the village without waiting for the chain…
  // (the keyboard focus is still on the Portal's door)
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect(enter).toBeVisible({ timeout: 20_000 });
  const chain = createPublicClient({ chain: foundry, transport: http() });
  const fromBlock = await chain.getBlockNumber();
  await enter.click();
  const clicked = Date.now();
  await expect(page).toHaveURL(/#\/b\/portal$/);
  const panel = page.getByRole("region", { name: /Portal de los Mundos|Portal of Worlds/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("article", { name: "ALDEA World" })).toBeVisible();
  expect(Date.now() - clicked).toBeLessThan(2_000);
  await expect(village(page)).toHaveAttribute("data-ready", "true");
  await page.screenshot({ path: "test-results/village-panel.png" });

  // …and the entry reaches the chain in the background (the 3 s p95 target is for staging; a local anvil may be
  // mining every 2 s, so here it gets one block more)
  const entered = parseAbiItem("event BuildingEntered(uint32 indexed characterId, bytes32 indexed buildingId, bytes32 indexed almaIdHash)");
  const left = parseAbiItem("event BuildingLeft(uint32 indexed characterId, bytes32 indexed buildingId)");
  const entries = () => chain.getLogs({ event: entered, args: { buildingId: buildingId("portal") }, fromBlock });
  await expect.poll(async () => (await entries()).length, { timeout: 5_000 }).toBe(1);
  const characterId = (await entries())[0]!.args.characterId!;

  // Closing the panel (Escape) goes back to the village and records the exit
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/#\/$/);
  await expect.poll(async () => (await chain.getLogs({ event: left, args: { characterId }, fromBlock })).length, { timeout: 12_000 }).toBe(1);
});
