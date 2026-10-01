import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * The village as a game: guests see the isometric map and reach buildings from it; a born soul has a character that
 * walks with the keyboard and with clicks, and is offered to go into a building when it stands at its door.
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
  await expect(page.getByTestId("census")).toContainText(/almas nacidas|souls born/);

  const canvas = village(page).locator("canvas");
  await expect(canvas).toHaveAttribute("aria-label", /aldea|village/i);
  await canvas.focus();
  await page.keyboard.press("Tab");
  await expect(village(page)).toHaveAttribute("data-door", /.+/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/b\/[a-z-]+$/);
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

  // Tab to the first door and Enter: the character walks there and the door is offered
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(village(page)).toHaveAttribute("data-door", /.+/, { timeout: 20_000 });
  const enter = page.getByTestId("enter-building");
  await expect(enter).toBeVisible();
  await page.screenshot({ path: "test-results/village-door.png" });

  // A click on the ground walks away from the door, and the offer goes with it
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 150, box.y + box.height / 2 + 120);
  await expect(enter).toBeHidden({ timeout: 10_000 });

  // Back to the door with Enter twice: walk, then go in
  await canvas.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(enter).toBeVisible({ timeout: 20_000 });
  await enter.click();
  await expect(page).toHaveURL(/#\/b\/[a-z-]+$/);
});
