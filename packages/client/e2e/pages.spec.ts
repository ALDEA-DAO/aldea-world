import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * What surrounds the game: the welcome a guest finds, Settings (language, theme, motion, signing out), the reading
 * pages (About, Terms, Privacy), the soul card to share, and the product events all of it emits, none with personal
 * data. Needs the local stack (`pnpm dev`).
 */

async function passkeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

interface Tracked {
  event: string;
  props: Record<string, string | number | boolean>;
}
/** Collects the page's product events from its first script on, across reloads and the sign-in round trip. */
async function recordEvents(page: Page): Promise<() => Promise<Tracked[]>> {
  const events: Tracked[] = [];
  await page.exposeFunction("__tracked", (tracked: Tracked) => void events.push(tracked));
  await page.addInitScript(() => window.addEventListener("aldea:analytics", (e) => void (window as unknown as { __tracked: (t: unknown) => void }).__tracked((e as CustomEvent).detail)));
  return async () => events;
}
const named = (events: Tracked[]) => events.map((e) => e.event);

async function expectNoSeriousViolations(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, `${name}\n${serious.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n")}`).toEqual([]);
}

test.use({ locale: "es-AR" });

test("a guest is welcomed over the village, once, and the page describes itself to whoever shares it", async ({ page }) => {
  const events = await recordEvents(page);
  await page.goto("/#/");
  const welcome = page.getByTestId("guest-intro");
  await expect(welcome.getByRole("heading", { name: "Nace en ALDEA. Tu alma viaja contigo." })).toBeVisible({ timeout: 30_000 });
  // No Genesis configured on a fresh local chain: no dates are announced
  await expect(welcome.getByTestId("genesis-dates")).toHaveCount(0);
  await expectNoSeriousViolations(page, "#/ (welcome)");

  await welcome.getByRole("button", { name: "Solo mirar" }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("village")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect(page.getByTestId("guest-intro")).toHaveCount(0);

  // Link previews read the root document: hash routes have none of their own
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Nace en ALDEA. Tu alma viaja contigo.");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const image = await page.request.get("/og.png");
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect((await page.locator('meta[name="description"]').getAttribute("content"))!.length).toBeGreaterThan(120);

  // A landing per load (the dev server may reload the page once more on its own), and nothing that names anyone
  expect(named(await events()).filter((e) => e === "landing_viewed").length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(await events())).not.toMatch(/alma:main|0x[0-9a-fA-F]{16,}|@/);
});

test("settings: language, theme and motion apply at once and are remembered", async ({ page }) => {
  await page.goto("/#/ajustes");
  await expect(page.getByRole("heading", { name: "Ajustes", level: 1 })).toBeVisible();
  // A guest has no keys and no session to close
  await expect(page.getByRole("button", { name: /Cerrar sesión/ })).toHaveCount(0);

  // English, without reloading: the screen, the top bar and the menu
  await page.getByRole("group", { name: "Idioma" }).getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link")).toHaveText(["Village", "List mode", "Portal of Worlds", "Settings", "About", "Terms", "Privacy", "Design kit"]);
  await page.keyboard.press("Escape");

  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("group", { name: "Motion" }).getByRole("button", { name: "Always reduced" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  // Whatever the system says, nothing animates for long
  expect(await page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^(0s|1e-05s|0\.00001s)$/);
  await expectNoSeriousViolations(page, "#/ajustes (dark)");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.getByRole("group", { name: "Motion" }).getByRole("button", { name: "Always reduced" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("group", { name: "Motion" }).getByRole("button", { name: "Follow the system" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "reduced");
});

test("about, terms and privacy: reachable from the menu, readable, and honest about being drafts", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("button", { name: "Menú" }).click();
  await page.getByRole("navigation", { name: "Menú" }).getByRole("link", { name: "Acerca de" }).click();
  await expect(page).toHaveURL(/#\/acerca$/);
  await expect(page.getByRole("heading", { name: "Acerca de ALDEA World", level: 1 })).toBeVisible();
  // Who holds each power, and what is still held as temporary trust
  await expect(page.getByRole("table").getByRole("rowheader")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Confianza temporal declarada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ALDEA-DAO/aldea-world" })).toHaveAttribute("href", "https://github.com/ALDEA-DAO/aldea-world");
  await expect(page.getByText(/Kenney/)).toBeVisible();
  await expectNoSeriousViolations(page, "#/acerca");

  // From its foot to the legal texts, and between them
  await page.locator("article footer").getByRole("link", { name: "Términos" }).click();
  await expect(page.getByRole("heading", { name: "Términos", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toHaveText(/Borrador: este texto está en revisión legal/);
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(7);
  await expectNoSeriousViolations(page, "#/terminos");
  await page.locator("article footer").getByRole("link", { name: "Privacidad" }).click();
  await expect(page.getByRole("heading", { name: "Privacidad", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lo que es público por naturaleza" })).toBeVisible();
  await expect(page.getByRole("link", { name: /team@aldea\.world/ })).toHaveAttribute("href", "mailto:team@aldea.world");
  await expectNoSeriousViolations(page, "#/privacidad");
  // One column a person can read: no more than about 65 characters per line
  const { width, fontSize } = await page.locator("article").evaluate((el) => ({ width: el.clientWidth, fontSize: Number.parseFloat(getComputedStyle(el).fontSize) }));
  expect(width / fontSize).toBeLessThanOrEqual(40);

  await page.goto("/#/no-existe");
  await expect(page.getByRole("heading", { name: "Este camino no lleva a ninguna parte" })).toBeVisible();
  await expect(page.getByText(/próxima fase/)).toHaveCount(0);
});

test("a born soul shares its card, and the funnel's events carry nothing personal", async ({ context, page }) => {
  test.setTimeout(120_000);
  const events = await recordEvents(page);
  await passkeyDevice(context, page);
  await page.goto("/#/b/centro-urbano");
  await page.getByRole("button", { name: /^Entrar$/ }).click();
  await page.getByRole("button", { name: /Crear mi alma/ }).click();
  await expect(page).toHaveURL(/#\/b\/centro-urbano$/);
  await page.getByRole("radio").first().click();
  await page.getByRole("button", { name: /^Nacer como / }).click();
  await expect(page.getByText(/Tu alma ya tiene nombre/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: /Ver tu alma/ }).click();

  const almaId = (await page.getByTitle(/^alma:main:human:/).first().getAttribute("title"))!;
  // The card is offered once the Resolver has recorded the tribe
  const open = page.getByRole("button", { name: "Compartir mi alma" });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Tu alma, para compartir" });
  const card = dialog.getByTestId("soul-card");
  await expect(card).toContainText("ALDEA World");
  await expect(card).toContainText("aldea.world");
  await expect(card).toContainText(`${almaId.slice(-32, -26)}…${almaId.slice(-4)}`);
  // Nothing private on it: not the whole identifier, no account
  const text = (await card.textContent())!;
  expect(text).not.toContain(almaId);
  expect(text).not.toMatch(/0x[0-9a-fA-F]{8,}|stake|addr/);
  await expectNoSeriousViolations(page, "soul card dialog");

  // This browser cannot share files: the image is downloaded and the soul's link copied
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const started = Date.now();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Compartir" }).click()]);
  // The goal is 2 s on a phone; here it takes 3 to 5 s on a dev server, so this only guards against getting worse
  expect(Date.now() - started).toBeLessThan(15_000);
  expect(download.suggestedFilename()).toBe("alma-aldea.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.length).toBeGreaterThan(20_000);
  await expect(dialog.getByRole("status")).toHaveText("Descargamos la imagen y copiamos el enlace a tu alma.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://localhost:3100/#/alma/${almaId}`);

  const all = await events();
  for (const name of ["landing_viewed", "login_started", "login_completed", "soul_prepared", "birth_requested", "birth_completed", "building_entered", "soul_card_shared"]) expect(named(all), name).toContain(name);
  const born = all.find((e) => e.event === "birth_completed")!;
  expect(born.props.latencyMs).toBeGreaterThan(1_000);
  expect(born.props.latencyMs).toBeLessThan(60_000);
  expect(Object.keys(born.props).sort()).toEqual(["class", "latencyMs", "tribe"]);
  expect(all.find((e) => e.event === "soul_card_shared")!.props).toEqual({ method: "downloaded" });
  // No event names the soul, an account or anything that looks like one
  expect(JSON.stringify(all)).not.toMatch(/alma:main|0x[0-9a-fA-F]{16,}|@/);

  // Signing out from Settings ends the session
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await page.goto("/#/ajustes");
  await page.getByRole("button", { name: "Cerrar sesión" }).first().click();
  await expect(page.getByRole("button", { name: /^Entrar$/ })).toBeVisible();
});
