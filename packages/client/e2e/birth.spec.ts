import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { worldAbi } from "@aldea/shared/abis";
import { createPublicClient, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { decodeGameError } from "../src/lib/errors";

/**
 * The magic moment, locally: sign in with a passkey, pick a class with the keyboard, be born. With no Midwife
 * running, the client completes the birth itself (FR-011) within 30 s; the tribe is revealed without scale or
 * particles when the system asks for reduced motion. A second birth fails with its own copy.
 * Needs the local stack with anvil producing blocks and the World deployed.
 */

const deployment = JSON.parse(readFileSync(new URL("../../shared/src/deployments/31337.json", import.meta.url), "utf8")) as { world: { address: Address } };

async function passkeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test("a soul is born as an Archer, chosen with the keyboard, and learns its tribe", async ({ context, page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await passkeyDevice(context, page);

  await page.goto("/#/b/centro-urbano");
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/ }).click();
  await page.getByRole("button", { name: /Entrar con mi passkey|Sign in with my passkey/ }).click();
  await page.getByRole("button", { name: /Crear mi alma|Create my soul/ }).click();
  await expect(page).toHaveURL(/#\/b\/centro-urbano$/);

  // Keyboard only: into the group, wander, and come back to the first class (Archer, index 0)
  const radios = page.getByRole("radio");
  await radios.first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await expect(radios.first()).toHaveAttribute("aria-checked", "true");
  const beBorn = page.getByRole("button", { name: /Nacer como Arquero|Be born as Archer/ });
  await beBorn.focus();
  await page.keyboard.press("Enter");

  const requested = Date.now();
  await expect(page.getByText(/Tu alma está llegando|Your soul is arriving/)).toBeVisible();
  // Reduced motion: the embers hold still
  expect(await page.locator(".embers span").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  await expect(page.getByText(/Tu alma ya tiene nombre|Your soul now has a name/)).toBeVisible({ timeout: 45_000 });
  expect(Date.now() - requested).toBeLessThan(45_000);
  // The reveal fades in, without scale or blur
  expect(await page.locator(".tribe-reveal").evaluate((el) => getComputedStyle(el).animationName)).toBe("fade-in");
  await expect(page.getByText(/Arquero|Archer/).first()).toBeVisible();

  await page.getByRole("button", { name: /Recorrer la aldea|Explore the village/ }).click();
  await page.getByRole("tab", { name: /Censo|Census/ }).click();
  await expect(page.getByText(/[1-9]\d* (almas nacidas|souls born)/)).toBeVisible();

  // One person, one character: a second request fails with its own copy
  const almaId = (await page.getByTitle(/^alma:main:human:/).getAttribute("title"))!;
  const devKey = (await page.evaluate((id) => localStorage.getItem(`aldea:dev-owner:${id}`), almaId)) as Hex;
  const client = createPublicClient({ chain: foundry, transport: http() });
  const second = await client
    .simulateContract({
      account: privateKeyToAccount(devKey),
      address: deployment.world.address,
      abi: worldAbi,
      functionName: "aldea__requestBirth",
      args: [1, keccak256(toBytes(almaId))],
    })
    .catch((err: unknown) => err);
  expect(decodeGameError(second)).toMatchObject({ name: "CharacterSystem_AlreadyHasCharacter", copyKey: "errors.alreadyHasCharacter" });
});
