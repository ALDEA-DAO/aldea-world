import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { worldAbi } from "@aldea/shared/abis";
import { createPublicClient, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { decodeGameError } from "../src/lib/errors";

/**
 * The magic moment, locally: sign in with a passkey, pick a class with the keyboard, be born. The Midwife completes
 * the birth (or, without it, the client does after 20 s, FR-011); the tribe is revealed without scale or particles
 * when the system asks for reduced motion; the Resolver records the soul's tribe membership within 10 s. A second
 * birth fails with its own copy.
 * Needs the full local stack (`pnpm dev`): anvil producing blocks, the World, Effectstream, the relay and the Resolver.
 */

const RESOLVER = process.env.E2E_RESOLVER_URL ?? "http://localhost:8787";
const deployment = JSON.parse(readFileSync(new URL("../../shared/src/deployments/31337.json", import.meta.url), "utf8")) as { world: { address: Address } };

async function passkeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test("a soul is born as an Archer, chosen with the keyboard, and learns its tribe", async ({ browser, context, page }) => {
  test.setTimeout(90_000);
  // Another browser, a guest with the census open: it must see this birth without reloading
  const guest = await (await browser.newContext()).newPage();
  await guest.goto("/#/b/centro-urbano");
  await guest.getByRole("tab", { name: /Censo|Census/ }).click();
  const bornCount = async () => Number((await guest.getByTestId("mini-census").locator("span.font-bold").textContent()) ?? "0");
  await expect(guest.getByTestId("census-panel")).toBeVisible();
  const before = await bornCount();
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
  // …and within 5 s the other browser's census (HUD and panel) counts it
  await expect.poll(bornCount, { timeout: 5_000 }).toBe(before + 1);
  await expect(guest.getByTestId("census-panel")).toContainText(new RegExp(`${before + 1} (almas nacidas|souls born)`));
  expect(Date.now() - requested).toBeLessThan(45_000);
  // The reveal fades in, without scale or blur
  expect(await page.locator(".tribe-reveal").evaluate((el) => getComputedStyle(el).animationName)).toBe("fade-in");
  await expect(page.getByText(/Arquero|Archer/).first()).toBeVisible();

  // "Explore the village" closes the Town Center: the newborn is standing in the village
  await page.getByRole("button", { name: /Recorrer la aldea|Explore the village/ }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId("village")).toHaveAttribute("data-tile", /\d+,\d+/, { timeout: 20_000 });
  await page.goto("/#/b/centro-urbano");
  await page.getByRole("tab", { name: /Censo|Census/ }).click();
  await expect(page.getByTestId("census-panel")).toContainText(/[1-9]\d* (almas nacidas|souls born)/);

  const almaId = (await page.getByTitle(/^alma:main:human:/).first().getAttribute("title"))!;

  // Within 10 s the Resolver knows: the soul is active and a member of its tribe's organization, with evidence
  const soul = async () => (await (await fetch(`${RESOLVER}/v1/souls/${almaId}`)).json()) as { status: string; tribe: { almaId: string } | null; relationships: { type: string; to: string; evidence: { event: string } }[] };
  await expect.poll(async () => (await soul()).status, { timeout: 10_000 }).toBe("active");
  const { tribe, relationships } = await soul();
  expect(relationships).toEqual([{ type: "member_of", to: tribe!.almaId, evidence: expect.objectContaining({ event: "CharacterBorn" }) }]);
  const members = (await (await fetch(`${RESOLVER}/v1/orgs/${tribe!.almaId}/members`)).json()) as { items: { almaId: string; characterClass: number }[] };
  expect(members.items).toContainEqual(expect.objectContaining({ almaId, characterClass: 0 }));

  // "Your soul" shows the identifier, the tribe and the birth transaction as its evidence
  await page.goto("/#/b/registro-de-almas");
  const ties = page.getByRole("region", { name: /Tus lazos|Your ties/ });
  await expect(ties.getByText(/Amazónicos|Himalayos|Poseidones|Raes|Tropicales|Amazonians|Himalayans|Poseidons|Tropicals/)).toBeVisible({ timeout: 10_000 });
  await expect(ties.getByText(/^0x[0-9a-f]{4}…[0-9a-f]{4}$/)).toBeVisible();
  await expect(page.getByRole("region", { name: /Tu alma|Your soul/ }).getByText(almaId)).toBeVisible();

  // "My tribe": the members list includes this soul, marked as you, with its evidence
  await page.getByRole("button", { name: /^(Mi tribu|My tribe)$/ }).click();
  const tribeList = page.getByTestId("tribe-members");
  await expect(tribeList.getByTitle(almaId)).toBeVisible();
  await expect(tribeList.getByText(/^(tú|you)$/)).toBeVisible();
  await expect(page.getByRole("region", { name: /^(Sellos|Seals)$/ })).toBeVisible();
  await page.screenshot({ path: "test-results/soul-registry.png", fullPage: true });

  // Anyone's public view of this soul: identity, tribe and seals, but no keys and no private addresses
  const devKey = (await page.evaluate((id) => localStorage.getItem(`aldea:dev-owner:${id}`), almaId)) as Hex;
  const owner = privateKeyToAccount(devKey).address;
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/#/alma/${encodeURIComponent(almaId)}`);
  const view = visitor.getByTestId("soul-registry");
  await expect(view.getByText(almaId)).toBeVisible();
  await expect(view.getByText(/Amazónicos|Himalayos|Poseidones|Raes|Tropicales|Amazonians|Himalayans|Poseidons|Tropicals/)).toBeVisible();
  await expect(visitor.getByRole("heading", { name: /Tus llaves|Your keys/ })).toHaveCount(0);
  const text = (await visitor.locator("body").innerText()).toLowerCase();
  expect(text).not.toContain(owner.toLowerCase());
  expect(text).not.toContain(owner.slice(2, 8).toLowerCase());
  await visitor.screenshot({ path: "test-results/soul-public.png", fullPage: true });

  // One person, one character: a second request fails with its own copy
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
